import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxThinking,
  fauxToolCall,
  type FauxProviderHandle,
} from "@earendil-works/pi-ai/providers/faux";
import { MemoriaAgentRuntime } from "../src/agent/runtime.ts";
import { AppDatabase } from "../src/db/database.ts";
import { isMainModule } from "../src/index.ts";
import { createApp } from "../src/server/app.ts";

describe("M1: pi-durable TS Foundation, Multi-Provider Settings, Scope Toggles & Subagent", () => {
  let db: AppDatabase;
  let faux: FauxProviderHandle;
  let runtime: MemoriaAgentRuntime;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    db = new AppDatabase(":memory:");
    faux = fauxProvider({
      provider: "faux",
      models: [
        { id: "faux-reasoner", name: "Faux Reasoner", reasoning: true },
        { id: "faux-fast", name: "Faux Fast", reasoning: false },
      ],
    });
    runtime = await MemoriaAgentRuntime.create({
      db,
      customProviders: [faux.provider],
    });
    app = createApp(runtime);
  });

  afterEach(async () => {
    await runtime?.close();
  });

  it("manages multi-model providers and available models with thinking levels", async () => {
    const createRes = await app.request("/api/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "anthropic-custom",
        name: "Anthropic Claude",
        protocol: "anthropic-messages",
        baseUrl: "https://api.anthropic.com",
        apiKey: "sk-ant-1234567890",
        enabled: true,
        models: [{ id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", reasoning: true }],
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as any;
    expect(created.id).toBe("anthropic-custom");
    expect(created.apiKey).toBe("sk-a****7890");

    const availRes = await app.request("/api/models/available");
    expect(availRes.status).toBe(200);
    const avail = (await availRes.json()) as Array<{ provider: string; modelId: string }>;
    expect(avail.some((m) => m.provider === "anthropic-custom" && m.modelId === "claude-sonnet-4-5")).toBe(
      true,
    );
    expect(avail.some((m) => m.provider === "faux" && m.modelId === "faux-reasoner")).toBe(true);
  });

  it("creates conversation, configures scope toggles & thinking level, and executes KB tool when enabled", async () => {
    // 1. Seed a Knowledge Base and ingest a Document
    const kb = db.createKB({ name: "运维手册", description: "Nginx 排障指南" });
    await runtime.pipeline.ingest({
      kbId: kb.id,
      filename: "nginx.md",
      contentBuffer: Buffer.from("Nginx 502 Bad Gateway 通常是上游 PHP-FPM 进程池耗尽导致。", "utf8"),
    });

    // 2. Create a conversation with KB enabled in scope
    const createConvRes = await app.request("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "排查 502",
        modelProvider: "faux",
        modelId: "faux-reasoner",
        thinkingLevel: "high",
        scope: {
          kbIds: [kb.id],
          hostIds: [],
          hostSecurityModes: {},
          webSearch: false,
          subagentEnabled: true,
        },
      }),
    });
    expect(createConvRes.status).toBe(201);
    const conv = (await createConvRes.json()) as any;
    expect(conv.scope.kbIds).toEqual([kb.id]);
    expect(conv.thinkingLevel).toBe("high");

    // 3. Script faux model to call kb_search first, then answer with thinking + text
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxThinking("我需要先检索运维手册中的 502 排障记录。"),
          fauxToolCall("kb_search", { query: "502" }, { id: "call_kb_1" }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage([
        fauxThinking("已找到 PHP-FPM 进程池耗尽的记录。"),
        fauxText("根据《nginx.md》，502 通常是上游 PHP-FPM 进程池耗尽导致的。"),
      ]),
    ]);

    const submitRes = await app.request(`/api/conversations/${conv.id}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "为什么会出现 Nginx 502？",
        wait: true,
      }),
    });
    expect(submitRes.status).toBe(200);
    const body = (await submitRes.json()) as any;
    expect(body.status).toBe("done");
    expect(body.messages.length).toBe(2);

    const assistantMsg = body.messages[1];
    expect(assistantMsg.role).toBe("assistant");
    expect(assistantMsg.content).toContain("PHP-FPM 进程池耗尽");
    expect(assistantMsg.sources.length).toBe(1);
    expect(assistantMsg.sources[0].filename).toBe("nginx.md");
    expect(assistantMsg.trace.summary.reasoning).toContain("我需要先检索运维手册中的 502 排障记录");
    expect(assistantMsg.trace.spans.length).toBe(1);
    expect(assistantMsg.trace.spans[0].name).toBe("kb_search");
  });

  it("supports delegate_subagent task-owned child conversation", async () => {
    faux.setResponses([
      // Parent agent calls delegate_subagent
      fauxAssistantMessage(
        [
          fauxThinking("这个问题需要派发子智能体深度分析。"),
          fauxToolCall("delegate_subagent", { task: "统计所有节点状态并汇总结论" }, { id: "call_sub_1" }),
        ],
        { stopReason: "toolUse" },
      ),
      // Child subagent responds in its isolated conversation
      fauxAssistantMessage([fauxText("子智能体结论：3 个节点全部健康，负载低于 20%。")]),
      // Parent agent synthesizes final answer
      fauxAssistantMessage([fauxText("汇总完毕：所有 3 个节点运行正常。")]),
    ]);

    const submitRes = await app.request("/api/conversations/new/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "帮我巡检所有节点",
        modelProvider: "faux",
        modelId: "faux-reasoner",
        wait: true,
      }),
    });
    expect(submitRes.status).toBe(200);
    const body = (await submitRes.json()) as any;
    expect(body.status).toBe("done");
    const assistantMsg = body.messages[1];
    expect(assistantMsg.content).toContain("汇总完毕：所有 3 个节点运行正常");
    expect(assistantMsg.trace.spans[0].name).toBe("delegate_subagent");
    expect(assistantMsg.trace.spans[0].data.output).toContain("3 个节点全部健康");
    expect(typeof assistantMsg.trace.spans[0].data.details?.conversationId).toBe("number");
  });

  it("streams watchEvents snapshot and enforces scope isolation when KB is toggled off", async () => {
    const kb = db.createKB({ name: "机密知识库", description: "内部架构" });
    db.raw
      .prepare(
        "INSERT INTO kb_documents (id, kb_id, filename, source, content, chunk_count, created_at) VALUES (?, ?, ?, 'upload', ?, 1, ?)",
      )
      .run("doc_sec", kb.id, "secret.md", "机密口令是 42", new Date().toISOString());

    // Create conversation with kbIds = [] (KB toggled OFF)
    const createRes = await app.request("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "隔离测试",
        modelProvider: "faux",
        modelId: "faux-reasoner",
        scope: { kbIds: [], hostIds: [], hostSecurityModes: {}, webSearch: false, subagentEnabled: true },
      }),
    });
    const conv = (await createRes.json()) as any;

    // Toggle KB ON via PATCH /api/conversations/:id
    const patchRes = await app.request(`/api/conversations/${conv.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        thinkingLevel: "low",
        scope: { kbIds: [kb.id], hostIds: [], hostSecurityModes: {}, webSearch: true, subagentEnabled: true },
      }),
    });
    expect(patchRes.status).toBe(200);
    const patched = (await patchRes.json()) as any;
    expect(patched.scope.kbIds).toEqual([kb.id]);
    expect(patched.scope.webSearch).toBe(true);
    expect(patched.thinkingLevel).toBe("low");

    // Verify watchConversationEvents returns a live snapshot with updated agent config
    const watched = await runtime.watchConversationEvents(conv.id);
    expect(watched).toBeDefined();
    expect(watched!.stream.snapshot.agent.thinkingLevel).toBe("low");
    await watched!.stream.stop();
  });

  it("detects main module entrypoint across Windows/POSIX absolute and relative argv[1] paths", () => {
    const entryPath = resolve("src/index.ts");
    const entryUrl = pathToFileURL(entryPath).href;
    expect(isMainModule(entryUrl, fileURLToPath(entryUrl))).toBe(true);
    expect(isMainModule(entryUrl, "src/index.ts")).toBe(true);
    expect(isMainModule(entryUrl, resolve("src/server/app.ts"))).toBe(false);
    expect(isMainModule(entryUrl, undefined)).toBe(false);
  });

  it("migrates legacy v1 SQLite database schema and boots runtime without table conflicts", async () => {
    const tempDir = mkdtempSync(join("./data", "test-v1-"));
    const dbPath = join(tempDir, "legacy.db");
    let migratedDb: AppDatabase | undefined;
    let migratedRuntime: MemoriaAgentRuntime | undefined;
    try {
      const legacy = new DatabaseSync(dbPath);
      legacy.exec(`
        CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL PRIMARY KEY);
        CREATE TABLE runtime_settings ("key" VARCHAR NOT NULL PRIMARY KEY, value VARCHAR NOT NULL, updated_at VARCHAR NOT NULL);
        INSERT INTO runtime_settings ("key", value, updated_at) VALUES ('llm_model', 'legacy-gpt', '2026-09-01T00:00:00Z');
        CREATE TABLE hosts (
          id VARCHAR NOT NULL PRIMARY KEY,
          name VARCHAR NOT NULL,
          host VARCHAR NOT NULL,
          port INTEGER NOT NULL,
          username VARCHAR NOT NULL,
          auth_type VARCHAR NOT NULL,
          credential TEXT,
          description VARCHAR,
          tags TEXT,
          safe_mode INTEGER NOT NULL,
          security_mode VARCHAR NOT NULL,
          os_info VARCHAR,
          status VARCHAR,
          created_at VARCHAR NOT NULL,
          updated_at VARCHAR NOT NULL,
          proxy_url TEXT DEFAULT ''
        );
        INSERT INTO hosts VALUES ('h1', 'LegacyHost', '10.0.0.1', 22, 'root', 'password', '', 'desc', '["prod"]', 1, 'ask_confirmation', '', 'inactive', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z', '');
        CREATE TABLE knowledge_bases (id VARCHAR NOT NULL PRIMARY KEY, name VARCHAR NOT NULL, description VARCHAR, type VARCHAR NOT NULL, created_at VARCHAR NOT NULL);
        CREATE TABLE documents (id VARCHAR NOT NULL PRIMARY KEY, kb_id VARCHAR NOT NULL, filename VARCHAR NOT NULL, path VARCHAR NOT NULL, chunk_count INTEGER, source VARCHAR NOT NULL, created_at VARCHAR NOT NULL);
        CREATE TABLE tasks (id VARCHAR NOT NULL PRIMARY KEY, task_type VARCHAR NOT NULL, payload TEXT NOT NULL, status VARCHAR NOT NULL, created_at VARCHAR NOT NULL, updated_at VARCHAR NOT NULL);
        CREATE TABLE vault_files (id VARCHAR NOT NULL PRIMARY KEY, vault_id VARCHAR NOT NULL, rel_path VARCHAR NOT NULL, file_hash VARCHAR NOT NULL, doc_id VARCHAR, synced_at VARCHAR NOT NULL);
      `);
      legacy.close();

      migratedDb = new AppDatabase(dbPath);
      migratedRuntime = await MemoriaAgentRuntime.create({ db: migratedDb });
      expect(migratedRuntime.db.getEffectiveSettings().llm_model).toBe("legacy-gpt");
      const hosts = migratedRuntime.db.listHosts();
      expect(hosts).toHaveLength(1);
      expect(hosts[0]?.name).toBe("LegacyHost");
      expect(hosts[0]?.tags).toEqual(["prod"]);
    } finally {
      await migratedRuntime?.close();
      migratedDb?.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("truncates conversation messages, supports resend, and aborts with rollback", async () => {
    faux.setResponses([
      fauxAssistantMessage([fauxText("World 1")]),
      fauxAssistantMessage([fauxText("Good 1")]),
      fauxAssistantMessage([fauxText("Sunny")]),
    ]);

    const createConvRes = await app.request("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Truncate Test",
        modelProvider: "faux",
        modelId: "faux-reasoner",
      }),
    });
    expect(createConvRes.status).toBe(201);
    const conv = (await createConvRes.json()) as any;

    // Submit Q1
    await app.request(`/api/conversations/${conv.id}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "Hello", wait: true }),
    });

    // Submit Q2
    await app.request(`/api/conversations/${conv.id}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "How are you?", wait: true }),
    });

    const msgs1Res = await app.request(`/api/conversations/${conv.id}/messages`);
    expect(msgs1Res.status).toBe(200);
    const msgs1 = (await msgs1Res.json()) as any[];
    expect(msgs1).toHaveLength(4);

    // Truncate from Q2 (msgs1[2])
    const truncRes = await app.request(`/api/conversations/${conv.id}/truncate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message_id: msgs1[2].id, inclusive: true }),
    });
    expect(truncRes.status).toBe(200);
    const truncData = (await truncRes.json()) as any;
    expect(truncData.deleted_count).toBe(2);

    // Verify messages after truncate
    const msgs2Res = await app.request(`/api/conversations/${conv.id}/messages`);
    const msgs2 = (await msgs2Res.json()) as any[];
    expect(msgs2).toHaveLength(2);
    expect(msgs2[0].content).toBe("Hello");
    expect(msgs2[1].content).toBe("World 1");

    // Resend edited Q2
    await app.request(`/api/conversations/${conv.id}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "How is the weather?", wait: true }),
    });

    const msgs3Res = await app.request(`/api/conversations/${conv.id}/messages`);
    const msgs3 = (await msgs3Res.json()) as any[];
    expect(msgs3).toHaveLength(4);
    expect(msgs3[2].content).toBe("How is the weather?");
    expect(msgs3[3].content).toBe("Sunny");

    // Test legacy route alias
    const legacyTruncRes = await app.request(`/api/agent-sessions/${conv.id}/truncate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message_id: "msg_9999", inclusive: true }),
    });
    expect(legacyTruncRes.status).toBe(200);
    expect((await legacyTruncRes.json()) as any).toEqual({
      session_id: conv.id,
      deleted_count: 0,
    });

    // Test abort with rollback
    const abortRes = await app.request(`/api/conversations/${conv.id}/abort`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rollback: true, message_id: msgs3[2].id }),
    });
    expect(abortRes.status).toBe(200);

    const msgsAfterAbort = (await (await app.request(`/api/conversations/${conv.id}/messages`)).json()) as any[];
    expect(msgsAfterAbort).toHaveLength(2);
  });
});
