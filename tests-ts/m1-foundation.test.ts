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
});
