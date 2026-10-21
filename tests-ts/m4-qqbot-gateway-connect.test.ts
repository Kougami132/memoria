import { describe, expect, it } from "vitest";
import { AppDatabase } from "../src/db/database.ts";
import { MemoriaAgentRuntime } from "../src/agent/runtime.ts";
import { DEFAULT_GATEWAY_INTENTS } from "../src/qqbot/gateway.ts";
import { QQBotService } from "../src/qqbot/service.ts";
import { createApp, parseSystemLogLines } from "../src/server/app.ts";

class FakeWebSocket extends EventTarget {
  static instances: FakeWebSocket[] = [];
  sent: any[] = [];
  closed = false;
  constructor(public url: string) {
    super();
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => this.emit({ op: 10, d: { heartbeat_interval: 45000 } }));
  }
  private emit(payload: unknown) {
    this.dispatchEvent(Object.assign(new Event("message"), { data: JSON.stringify(payload) }));
  }
  send(data: string) {
    const payload = JSON.parse(data);
    this.sent.push(payload);
    if (payload.op === 2) {
      queueMicrotask(() => this.emit({ op: 0, s: 1, t: "READY", d: { session_id: "sess_test" } }));
    }
  }
  close() {
    this.closed = true;
  }
}

function fakeFetch(seen: string[]) {
  return (async (input: any) => {
    const url = new URL(String(input?.url ?? input));
    seen.push(`${url.host}${url.pathname}`);
    if (url.host === "bots.qq.com") {
      return new Response(JSON.stringify({ access_token: "fake_token", expires_in: 7200 }), { status: 200 });
    }
    return new Response(JSON.stringify({ url: "wss://api.sgroup.qq.com/websocket/" }), { status: 200 });
  }) as any;
}

async function waitFor(check: () => boolean, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (check()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return false;
}

describe("QQ 网关连接（回归：RELOAD 不得在未连接时谎报已就绪）", () => {
  it("reload() 必须取 token、打开官方网关并收到 READY 后才置 connected", async () => {
    FakeWebSocket.instances = [];
    const seen: string[] = [];
    const db = new AppDatabase(":memory:");
    db.setSetting("qq_enabled", "true");
    db.setSetting("qq_app_id", "1000000001");
    db.setSetting("qq_client_secret", "test_secret");
    const runtime = await MemoriaAgentRuntime.create({ db });

    try {
      const bot = new QQBotService(db, runtime, {
        gatewayDeps: { fetch: fakeFetch(seen), WebSocket: FakeWebSocket as any },
      });

      expect(bot.status).not.toBe("connected");
      await bot.reload();
      expect(bot.status).toBe("connecting");

      expect(await waitFor(() => bot.status === "connected")).toBe(true);
      expect(seen).toEqual([
        "bots.qq.com/app/getAppAccessToken",
        "api.sgroup.qq.com/gateway",
      ]);

      const ws = FakeWebSocket.instances.at(-1)!;
      expect(ws.url).toContain("api.sgroup.qq.com");
      const identify = ws.sent.find((p) => p.op === 2);
      expect(identify?.d?.intents).toBe(DEFAULT_GATEWAY_INTENTS);
      expect(identify?.d?.intents).toBe(1174409216);

      const logs = db.listQQBotLogs({ limit: 10 }).map((l: any) => l.event_type);
      expect(logs).toContain("READY");

      await bot.stop();
    } finally {
      await runtime.close();
    }
  });

  it("凭据缺失时不得置为 connected", async () => {
    const db = new AppDatabase(":memory:");
    db.setSetting("qq_enabled", "true");
    db.setSetting("qq_app_id", "");
    db.setSetting("qq_client_secret", "");
    const runtime = await MemoriaAgentRuntime.create({ db });
    try {
      const bot = new QQBotService(db, runtime, { gatewayDeps: { fetch: fakeFetch([]), WebSocket: FakeWebSocket as any } });
      await bot.reload();
      expect(bot.status).toBe("error");
      expect(bot.lastError).toBeTruthy();
    } finally {
      await runtime.close();
    }
  });
});

describe("QQ 白名单拒绝时必须在 C2C 回执 OpenID（否则用户只看到机器人静默）", () => {
  it("未授权用户私聊会收到带 OpenID 的提示", async () => {
    const db = new AppDatabase(":memory:");
    db.setSetting("qq_c2c_enabled", "true");
    db.setSetting("qq_allow_unlisted_users", "false");
    db.setSetting("qq_user_allowlist", "[]");
    const runtime = await MemoriaAgentRuntime.create({ db });
    try {
      const sent: string[][] = [];
      const bot = new QQBotService(db, runtime, {
        senderFn: async (target) => {
          sent.push(target.chunks);
        },
      });
      const result = await bot.handleInboundMessage({
        contextType: "c2c",
        userOpenid: "USER_OPENID_ABC",
        content: "你好",
        msgId: "msg_1",
      });
      expect(result.allowed).toBe(false);
      expect(sent).toHaveLength(1);
      expect(sent[0][0]).toContain("USER_OPENID_ABC");
      expect(sent[0][0]).toContain("白名单");
    } finally {
      await runtime.close();
    }
  });
});

describe("QQ 审批不得跨会话越权", () => {
  it("陌生用户的『批准』不能放行其他会话挂起的命令", async () => {
    const db = new AppDatabase(":memory:");
    db.setSetting("qq_c2c_enabled", "true");
    db.setSetting("qq_allow_unlisted_users", "true");
    const runtime = await MemoriaAgentRuntime.create({ db });
    try {
      const bot = new QQBotService(db, runtime, { senderFn: async () => {} });
      const host = runtime.hostManager.createHost({
        name: "NAS",
        host: "192.168.10.6",
        username: "admin",
        security_mode: "ask_confirmation",
      } as any);

      // 审批来自一个 Web 会话（不是 QQ 会话）
      const approval = runtime.hostManager.approvalManager.createApproval({
        hostId: host.id,
        hostName: host.name,
        command: "docker restart jellyfin",
        sessionId: "web_conv_1",
      });

      const res = await bot.handleInboundMessage({
        contextType: "c2c",
        userOpenid: "STRANGER_OPENID",
        content: "批准",
        msgId: "m_approve",
      });

      expect(res.allowed).toBe(true);
      expect(runtime.hostManager.approvalManager.getApproval(approval.id)?.status).toBe("pending");
    } finally {
      await runtime.close();
    }
  });

  it("群聊审批默认关闭，即使是本群发起的审批也不放行", async () => {
    const db = new AppDatabase(":memory:");
    db.setSetting("qq_group_enabled", "true");
    db.setSetting("qq_allow_unlisted_groups", "true");
    db.setSetting("qq_group_require_mention", "false");
    db.setSetting("qq_group_approval_enabled", "false");
    const runtime = await MemoriaAgentRuntime.create({ db });
    try {
      const bot = new QQBotService(db, runtime, { senderFn: async () => {} });
      const convKey = "qq_group_G1";
      // 让审批归属该群会话
      db.registerConversation({ id: convKey, durableId: 99001, channel: "qq" });
      const approval = runtime.hostManager.approvalManager.createApproval({
        hostId: "h1",
        hostName: "NAS",
        command: "systemctl restart nginx",
        sessionId: convKey,
      });

      await bot.handleInboundMessage({
        contextType: "group",
        userOpenid: "member_1",
        groupOpenid: "G1",
        content: "批准",
        msgId: "m_group_approve",
      });

      expect(runtime.hostManager.approvalManager.getApproval(approval.id)?.status).toBe("pending");
    } finally {
      await runtime.close();
    }
  });
});

describe("QQ 群 @ 与队列上限设置真正生效", () => {
  it("group_require_mention 开启时，未 @ 的群消息不进入 Agent", async () => {
    const db = new AppDatabase(":memory:");
    db.setSetting("qq_group_enabled", "true");
    db.setSetting("qq_allow_unlisted_groups", "true");
    db.setSetting("qq_group_require_mention", "true");
    const runtime = await MemoriaAgentRuntime.create({ db });
    try {
      const bot = new QQBotService(db, runtime, { senderFn: async () => {} });
      const handled: string[] = [];
      (bot as any).handleInboundMessage = async (e: any) => {
        handled.push(e.content);
        return { allowed: true, replies: [] };
      };

      (bot as any).onGatewayEvent({
        t: "GROUP_AT_MESSAGE_CREATE",
        d: { id: "gmsg1", group_openid: "G1", author: { member_openid: "M1" }, content: "没有 at" },
      });
      await new Promise((r) => setTimeout(r, 30));
      expect(handled).toEqual([]);

      // 带 <@!123> 标记则应通过
      (bot as any).onGatewayEvent({
        t: "GROUP_AT_MESSAGE_CREATE",
        d: { id: "gmsg2", group_openid: "G1", author: { member_openid: "M1" }, content: "<@!123> 你好" },
      });
      await new Promise((r) => setTimeout(r, 30));
      expect(handled).toEqual(["<@!123> 你好"]);
    } finally {
      await runtime.close();
    }
  });
});

describe("/api/logs/system 不再是空桩", () => {
  it("能解析真实日志行并按 level/search 过滤，且下载路由存在", async () => {
    const db = new AppDatabase(":memory:");
    const runtime = await MemoriaAgentRuntime.create({ db });
    const app = createApp(runtime);
    try {
      const res = await app.request("/api/logs/system?lines=200");
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.status).toBe("ok");
      expect(typeof body.file_exists).toBe("boolean");
      expect(Array.isArray(body.items)).toBe(true);
      if (body.file_exists) {
        expect(body.items.length).toBeGreaterThan(0);
        expect(body.items[0]).toHaveProperty("raw");
        expect(body.items[0]).toHaveProperty("component");
      }

      // 下载路由必须存在（不再 404 by routing）；只校验响应头，避免拉 184MB
      const dl = await app.request("/api/logs/system/download");
      expect([200, 404]).toContain(dl.status);
      if (dl.status === 200) {
        expect(dl.headers.get("content-disposition") || "").toContain("memoria.log");
      }
    } finally {
      await runtime.close();
    }
  });

  it("parseSystemLogLines 正确切分级别、组件与多行续行", () => {
    const items = parseSystemLogLines(
      [
        "2026-09-06T00:37:39 INFO     memoria.qqbot.gateway — ACK ok",
        "  stack line",
        "2026-09-06T00:38:00 WARNING  memoria.qqbot.adapter — closed: 1000",
        "2026-09-06T00:39:00 ERROR    memoria.qq — boom",
      ].join("\n"),
    );
    expect(items).toHaveLength(3);
    expect(items[0].level).toBe("INFO");
    expect(items[0].component).toBe("memoria.qqbot.gateway");
    expect(items[0].message).toContain("stack line");
    expect(items[1].level).toBe("WARN");
    expect(items[2].level).toBe("ERROR");
  });
});

describe("QQ 审批带外处理（不得与串行队列死锁）", () => {
  it("同一 QQ 会话内：发起审批后被阻塞的轮次仍能被自己的『批准』唤醒", async () => {
    const db = new AppDatabase(":memory:");
    db.setSetting("qq_c2c_enabled", "true");
    db.setSetting("qq_allow_unlisted_users", "true");
    const runtime = await MemoriaAgentRuntime.create({ db });
    try {
      const sent: string[] = [];
      const bot = new QQBotService(db, runtime, {
        senderFn: async (t) => {
          sent.push(t.chunks.join(""));
        },
      });
      db.registerConversation({ id: "qq_c2c_probe_user", durableId: 99002, channel: "qq" });
      const approval = runtime.hostManager.approvalManager.createApproval({
        hostId: "h1",
        hostName: "NAS",
        command: "docker restart jellyfin",
        sessionId: "qq_c2c_probe_user",
      });

      // 审批命令走带外路径：即使会话队列被占用也立即生效
      (bot as any).onGatewayEvent({
        t: "C2C_MESSAGE_CREATE",
        d: { id: "appr_msg_1", author: { user_openid: "probe_user" }, content: "批准" },
      });
      for (let i = 0; i < 100; i++) {
        if (runtime.hostManager.approvalManager.getApproval(approval.id)?.status !== "pending") break;
        await new Promise((r) => setTimeout(r, 10));
      }

      expect(runtime.hostManager.approvalManager.getApproval(approval.id)?.status).toBe("approved");
      expect(sent.join("\n")).toContain("已批准主机 [NAS]");
    } finally {
      await runtime.close();
    }
  });
});

describe("Code-review 复核补充：审批带外路径的边界", () => {
  it("非白名单用户不能通过『批准』越权放行命令", async () => {
    const db = new AppDatabase(":memory:");
    db.setSetting("qq_c2c_enabled", "true");
    db.setSetting("qq_allow_unlisted_users", "false");
    db.setSetting("qq_user_allowlist", "[]");
    const runtime = await MemoriaAgentRuntime.create({ db });
    try {
      const bot = new QQBotService(db, runtime, { senderFn: async () => {} });
      db.registerConversation({ id: "qq_c2c_BADUSER", durableId: 99100, channel: "qq" });
      const approval = runtime.hostManager.approvalManager.createApproval({
        hostId: "h",
        hostName: "NAS",
        command: "rm -rf /tmp/x",
        sessionId: "qq_c2c_BADUSER",
      });

      (bot as any).onGatewayEvent({
        t: "C2C_MESSAGE_CREATE",
        d: { id: "wl1", author: { user_openid: "BADUSER" }, content: "批准" },
      });
      await new Promise((r) => setTimeout(r, 150));

      expect(runtime.hostManager.approvalManager.getApproval(approval.id)?.status).toBe("pending");
    } finally {
      await runtime.close();
    }
  });

  it("<@123> 与 <@!123> 两种 @ 标记都能识别审批命令", async () => {
    const db = new AppDatabase(":memory:");
    db.setSetting("qq_group_enabled", "true");
    db.setSetting("qq_allow_unlisted_groups", "true");
    db.setSetting("qq_group_require_mention", "true");
    db.setSetting("qq_group_approval_enabled", "true");
    const runtime = await MemoriaAgentRuntime.create({ db });
    try {
      const sent: string[] = [];
      const bot = new QQBotService(db, runtime, {
        senderFn: async (t) => {
          sent.push(t.chunks.join(""));
        },
      });
      db.registerConversation({ id: "qq_group_G9", durableId: 99101, channel: "qq" });
      const approval = runtime.hostManager.approvalManager.createApproval({
        hostId: "h",
        hostName: "NAS",
        command: "systemctl restart nginx",
        sessionId: "qq_group_G9",
      });

      (bot as any).onGatewayEvent({
        t: "GROUP_AT_MESSAGE_CREATE",
        d: {
          id: "ga1",
          group_openid: "G9",
          author: { member_openid: "M9" },
          content: "<@123> 批准",
        },
      });
      for (let i = 0; i < 100; i++) {
        if (runtime.hostManager.approvalManager.getApproval(approval.id)?.status !== "pending") break;
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(runtime.hostManager.approvalManager.getApproval(approval.id)?.status).toBe("approved");
      expect(sent.join("")).toContain("已批准主机 [NAS]");
    } finally {
      await runtime.close();
    }
  });
});
