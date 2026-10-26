import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  fauxAssistantMessage,
  fauxProvider,
  type FauxProviderHandle,
} from "@earendil-works/pi-ai/providers/faux";
import { MemoriaAgentRuntime } from "../src/agent/runtime.ts";
import { AppDatabase } from "../src/db/database.ts";
import { createApp } from "../src/server/app.ts";

describe("会话记录：模型调用失败不产生空气泡", () => {
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
    runtime = await MemoriaAgentRuntime.create({ db, customProviders: [faux.provider] });
    app = createApp(runtime);
  });

  afterEach(async () => {
    await runtime?.close();
  });

  it("模型返回 error 时只留一条可见的失败消息，而不是空助手气泡", async () => {
    faux.setResponses([
      fauxAssistantMessage([], {
        stopReason: "error",
        // 非重试类错误，避免等待退避
        errorMessage: "insufficient_quota: all accounts limited",
      }),
    ]);

    const { summary, submission } = await runtime.submitMessage({
      content: "查看nas状态",
      modelProvider: "faux",
      modelId: "faux-reasoner",
    });
    await submission.wait(BACKGROUND_CONTEXT);

    const res = await app.request(`/api/conversations/${summary.id}/messages`);
    const msgs = (await res.json()) as any[];

    expect(msgs.filter((m) => m.role === "assistant" && !m.content.trim())).toHaveLength(0);

    const failed = msgs.filter((m) => m.role === "assistant" && m.status === "failed");
    expect(failed).toHaveLength(1);
    expect(failed[0].content).toContain("all accounts limited");
  });

  it("重试耗尽后只留一条失败消息，而不是每次尝试一个空助手气泡", () => {
    // 生产环境的一次提问里，harness 按退避重试共落了 4 条 stopReason="error" 的助手条目。
    const errorEntry = (id: number) => ({
      id,
      kind: "pi.assistant",
      model: [
        {
          role: "assistant",
          content: [],
          stopReason: "error",
          errorMessage: `503: all accounts limited (attempt ${id})`,
        },
      ],
    });
    const entries = [
      { id: 1, kind: "pi.user", model: [{ role: "user", content: "查看nas状态" }] },
      errorEntry(2),
      errorEntry(3),
      errorEntry(4),
      errorEntry(5),
    ] as any[];

    const msgs = runtime.formatTranscriptToMessages("conv", entries, undefined, undefined);

    expect(msgs.filter((m) => m.role === "assistant" && !m.content.trim())).toHaveLength(0);
    const failed = msgs.filter((m) => m.role === "assistant");
    expect(failed).toHaveLength(1);
    expect(failed[0].status).toBe("failed");
    expect(failed[0].content).toContain("attempt 5");
  });
});
