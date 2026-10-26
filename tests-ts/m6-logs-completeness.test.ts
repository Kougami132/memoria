import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoriaAgentRuntime } from "../src/agent/runtime.ts";
import { AppDatabase } from "../src/db/database.ts";
import { createLogger } from "../src/logging.ts";
import { createApp, parseSystemLogLines } from "../src/server/app.ts";

// 整个文件共用一个临时日志目录，避免把测试写入真实 data/memoria.log。
let sharedDir: string;

beforeAll(() => {
  sharedDir = mkdtempSync(join(tmpdir(), "memoria-log-"));
  process.env.LOG_PATH = join(sharedDir, "memoria.log");
});

afterAll(() => {
  delete process.env.LOG_PATH;
  rmSync(sharedDir, { recursive: true, force: true });
});

describe("系统日志：运行期写入端", () => {
  let dir: string;
  let logPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "memoria-log-case-"));
    logPath = join(dir, "memoria.log");
    process.env.LOG_PATH = logPath;
  });

  afterEach(() => {
    process.env.LOG_PATH = join(sharedDir, "memoria.log");
    rmSync(dir, { recursive: true, force: true });
  });

  it("logger 写入的记录能被 /api/logs/system 原样读出", async () => {
    const db = new AppDatabase(":memory:");
    const runtime = await MemoriaAgentRuntime.create({ db });
    const app = createApp(runtime);
    try {
      createLogger("memoria.server.app").info("服务已启动");

      const body = (await (await app.request("/api/logs/system?lines=50")).json()) as any;

      expect(body.file_exists).toBe(true);
      const mine = body.items.find((i: any) => i.component === "memoria.server.app");
      expect(mine).toBeDefined();
      expect(mine.level).toBe("INFO");
      expect(mine.message).toBe("服务已启动");
    } finally {
      await runtime.close();
    }
  });
});

describe("系统日志：行解析", () => {
  it("组件名带连字符时不被分隔符截断", () => {
    const items = parseSystemLogLines("2026-10-26T08:00:00 INFO     memoria.vault-syncer — sync done");
    expect(items).toHaveLength(1);
    expect(items[0].component).toBe("memoria.vault-syncer");
    expect(items[0].message).toBe("sync done");
  });
});

describe("调用日志：失败路径留痕", () => {
  async function makeApp() {
    const db = new AppDatabase(":memory:");
    const runtime = await MemoriaAgentRuntime.create({ db });
    return { db, runtime, app: createApp(runtime) };
  }

  const chat = (app: any, body: unknown, headers: Record<string, string> = {}) =>
    app.request("/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });

  it("模型抛错时记录 500 与错误原因", async () => {
    const { runtime, app } = await makeApp();
    try {
      (runtime as any).submitMessage = async () => {
        throw new Error("model unavailable");
      };

      const res = await chat(app, { model: "memoria-agent", messages: [{ role: "user", content: "hi" }] });
      expect(res.status).toBe(500);

      const body = (await (await app.request("/api/logs/invocations")).json()) as any;
      expect(body.items).toHaveLength(1);
      expect(body.items[0].status_code).toBe(500);
      expect(body.items[0].error_msg).toContain("model unavailable");
    } finally {
      await runtime.close();
    }
  });
});

describe("调用日志：鉴权拒绝留痕", () => {
  it("Bearer token 错误时记录 401 且不泄漏 token 明文", async () => {
    const db = new AppDatabase(":memory:");
    db.setSetting("external_api_token", "sec_token_999");
    const runtime = await MemoriaAgentRuntime.create({ db });
    const app = createApp(runtime);
    try {
      const res = await app.request("/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer wrong_token_abc" },
        body: JSON.stringify({ model: "memoria-agent", messages: [{ role: "user", content: "hi" }] }),
      });
      expect(res.status).toBe(401);

      const body = (await (await app.request("/api/logs/invocations")).json()) as any;
      expect(body.items).toHaveLength(1);
      expect(body.items[0].status_code).toBe(401);
      expect(JSON.stringify(body.items[0])).not.toContain("wrong_token_abc");
      expect(JSON.stringify(body.items[0])).not.toContain("sec_token_999");
    } finally {
      await runtime.close();
    }
  });
});

describe("系统日志：服务启动与后台任务写入", () => {
  it("启动后系统日志里出现本次运行的服务生命周期记录", async () => {
    const db = new AppDatabase(":memory:");
    const runtime = await MemoriaAgentRuntime.create({ db });
    const app = createApp(runtime);
    try {
      const body = (await (await app.request("/api/logs/system?lines=200")).json()) as any;
      const components = body.items.map((i: any) => i.component);
      expect(components).toContain("memoria.agent.runtime");

      const newest = body.items[body.items.length - 1].timestamp;
      const ageMinutes = (Date.now() - new Date(newest).getTime()) / 60000;
      expect(ageMinutes).toBeLessThan(1);
    } finally {
      await runtime.close();
    }
  });
});

describe("系统日志：后台任务失败写入", () => {
  it("Vault 轮询失败写入 WARN 而非只到 stdout", async () => {
    const db = new AppDatabase(":memory:");
    const runtime = await MemoriaAgentRuntime.create({ db });
    const app = createApp(runtime);
    try {
      const kb = db.createKB({ name: "Vault KB", type: "vault" });
      runtime.vaultManager.createVault(kb.id, { type: "local", local_path: "/nonexistent" });
      (runtime.vaultManager as any).syncVault = async () => {
        throw new Error("vault unreachable");
      };

      await runtime.vaultManager.runPollCycle();

      const body = (await (await app.request("/api/logs/system?lines=200")).json()) as any;
      const warn = body.items.find(
        (i: any) => i.level === "WARN" && i.message.includes("vault unreachable"),
      );
      expect(warn).toBeDefined();
      expect(warn.component).toBe("memoria.vault.syncer");
    } finally {
      await runtime.close();
    }
  });
});

describe("系统日志：未捕获的路由异常留痕", () => {
  it("路由抛错时系统日志记录 ERROR 与错误线索", async () => {
    const db = new AppDatabase(":memory:");
    const runtime = await MemoriaAgentRuntime.create({ db });
    const app = createApp(runtime);
    try {
      app.get("/api/boom", () => {
        throw new Error("kaboom-9f3c");
      });

      const res = await app.request("/api/boom");
      expect(res.status).toBe(500);
      // 内部错误细节只进日志，不能回显给调用方。
      expect(await res.text()).not.toContain("kaboom-9f3c");

      const body = (await (await app.request("/api/logs/system?lines=200")).json()) as any;
      const hit = body.items.find((i: any) => i.level === "ERROR" && i.message.includes("kaboom-9f3c"));
      expect(hit).toBeDefined();
      expect(hit.component).toBe("memoria.server.app");
    } finally {
      await runtime.close();
    }
  });
});

describe("系统日志：startServer 生命周期", () => {
  it("启动后系统日志记录监听地址", async () => {
    const prevDbPath = process.env.DB_PATH;
    const prevPort = process.env.PORT;
    process.env.DB_PATH = ":memory:";
    const { startServer } = await import("../src/index.ts");
    const started = await startServer(0);
    try {
      const body = (await (await started.app.request("/api/logs/system?lines=200")).json()) as any;
      const boot = body.items.find(
        (i: any) => i.component === "memoria.server.index" && i.message.includes("listening"),
      );
      expect(boot).toBeDefined();
      expect(boot.level).toBe("INFO");
    } finally {
      await started.runtime.close();
      started.server.close();
      if (prevDbPath === undefined) delete process.env.DB_PATH;
      else process.env.DB_PATH = prevDbPath;
      if (prevPort === undefined) delete process.env.PORT;
      else process.env.PORT = prevPort;
    }
  }, 40000);
});
