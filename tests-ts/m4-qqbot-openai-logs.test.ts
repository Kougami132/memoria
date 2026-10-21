import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
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
import { splitMarkdown } from "../src/qqbot/service.ts";
import { createApp } from "../src/server/app.ts";

describe("M4: QQ Bot Gateway/Policy/Approval, /v1/chat/completions & Audit Logs", () => {
  let db: AppDatabase;
  let faux: FauxProviderHandle;
  let runtime: MemoriaAgentRuntime;
  let app: ReturnType<typeof createApp>;

  beforeEach(async () => {
    db = new AppDatabase(":memory:");
    faux = fauxProvider({
      provider: "faux",
      models: [{ id: "faux-reasoner", name: "Faux Reasoner", reasoning: true }],
    });
    runtime = await MemoriaAgentRuntime.create({
      db,
      customProviders: [faux.provider],
      hostRunner: async (host, cmd) => ({
        exitCode: 0,
        stdout: `[${host.name}] OK: ${cmd}`,
        stderr: "",
      }),
    });
    app = createApp(runtime);
  });

  afterEach(async () => {
    await runtime?.close();
  });

  it("enforces Bearer token on /v1/chat/completions, emits <thought> tags, and logs invocations", async () => {
    db.setSetting("external_api_token", "sec_token_999");

    // 1. Missing token -> 401
    const unauthRes = await app.request("/v1/models");
    expect(unauthRes.status).toBe(401);

    // 2. Valid token -> 200 on /v1/models
    const modelsRes = await app.request("/v1/models", {
      headers: { Authorization: "Bearer sec_token_999" },
    });
    expect(modelsRes.status).toBe(200);
    const modelsBody = (await modelsRes.json()) as any;
    expect(modelsBody.data.some((m: any) => m.id === "memoria-agent")).toBe(true);

    // 3. /v1/chat/completions non-streaming
    faux.setResponses([
      fauxAssistantMessage([
        fauxThinking("正在分析系统健康状态"),
        fauxText("系统一切正常。"),
      ]),
    ]);

    const chatRes = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer sec_token_999",
      },
      body: JSON.stringify({
        model: "faux/faux-reasoner",
        messages: [{ role: "user", content: "系统状态如何？" }],
        stream: false,
      }),
    });
    expect(chatRes.status).toBe(200);
    const chatBody = (await chatRes.json()) as any;
    expect(chatBody.choices[0].message.content).toContain("<thought>\n正在分析系统健康状态\n</thought>");
    expect(chatBody.choices[0].message.content).toContain("系统一切正常。");

    // 4. Verify audit log in /api/logs/invocations
    const logsRes = await app.request("/api/logs/invocations");
    expect(logsRes.status).toBe(200);
    const logsBody = (await logsRes.json()) as any;
    expect(logsBody.items.length).toBe(1);
    expect(logsBody.items[0].endpoint).toBe("/v1/chat/completions");
    expect(logsBody.items[0].status_code).toBe(200);
  });

  it("splits QQ Markdown preserving code fences, enforces allowlist, and approves SSH commands from QQ", async () => {
    // 1. Code-fence preserving Markdown split
    const longCode = "```bash\n" + "echo hello world\n".repeat(30) + "```";
    const parts = splitMarkdown(longCode, 200);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) {
      expect(p.startsWith("```")).toBe(true);
      expect(p.endsWith("```")).toBe(true);
    }

    // 2. Configure QQ Bot policy (only allow user_123)
    await app.request("/api/settings/qq", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: true,
        app_id: "102030",
        client_secret: "qq_secret_abc",
        c2c_enabled: true,
        allow_unlisted_users: false,
        user_allowlist: ["user_123"],
      }),
    });

    // Blocked user
    const blocked = await runtime.qqBot.handleInboundMessage({
      contextType: "c2c",
      userOpenid: "stranger_999",
      content: "你好",
      msgId: "m1",
    });
    expect(blocked.allowed).toBe(false);

    // Allowed user asking a question
    db.setSetting("default_provider", "faux");
    db.setSetting("llm_model", "faux-reasoner");
    faux.setResponses([fauxAssistantMessage([fauxText("你好！我是 QQ 助手。")])]);

    const allowed = await runtime.qqBot.handleInboundMessage({
      contextType: "c2c",
      userOpenid: "user_123",
      userName: "Kougami",
      content: "你好",
      msgId: "m2",
    });
    expect(allowed.allowed).toBe(true);
    expect(allowed.replies[0]).toContain("你好！我是 QQ 助手。");

    // 3. Approve a suspended SSH command via QQ "/approve" command
    const host = runtime.hostManager.createHost({
      name: "NAS Node",
      host: "192.168.10.6",
      username: "admin",
      security_mode: "ask_confirmation",
    });

    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("host_exec", { host_id: host.id, command: "docker restart jellyfin" }, { id: "c_qq" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage([fauxText("Jellyfin 容器已重启完成。")]),
    ]);

    // 审批必须由发起它的同一个 QQ 会话批准，因此这里直接用该 QQ 会话 id 发起。
    const qqConvId = "qq_c2c_user_123";
    const admitRes = await app.request(`/api/conversations/${qqConvId}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "重启 jellyfin",
        modelProvider: "faux",
        modelId: "faux-reasoner",
        scope: { kbIds: [], hostIds: [host.id], hostSecurityModes: {}, webSearch: false, subagentEnabled: true },
      }),
    });
    const admitBody = (await admitRes.json()) as any;

    // Wait for pending approval
    for (let i = 0; i < 40; i++) {
      if (runtime.hostManager.approvalManager.listPendingApprovals().length > 0) break;
      await new Promise((r) => setTimeout(r, 20));
    }

    // User sends "批准" in QQ
    const qqApprove = await runtime.qqBot.handleInboundMessage({
      contextType: "c2c",
      userOpenid: "user_123",
      content: "批准",
      msgId: "m3",
    });
    expect(qqApprove.allowed).toBe(true);
    expect(qqApprove.replies[0]).toContain("已批准主机 [NAS Node]");

    const conv = await runtime.harness.conversation(admitBody.conversation.durableId, BACKGROUND_CONTEXT);
    await conv!.waitForIdle(BACKGROUND_CONTEXT);

    const msgs = await runtime.getConversationMessages(admitBody.conversation.id);
    const lastAssistant = [...msgs!].reverse().find((m) => m.role === "assistant");
    expect(lastAssistant?.content).toContain("Jellyfin 容器已重启完成");

    // Verify QQ events logged
    const qqLogsRes = await app.request("/api/logs/qqbot/events");
    const qqLogsBody = (await qqLogsRes.json()) as any;
    expect(qqLogsBody.stats.total_events).toBeGreaterThanOrEqual(2);
  });
});
