import { describe, expect, it } from "vitest";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxThinking } from "@earendil-works/pi-ai/providers/faux";
import { MemoriaAgentRuntime } from "../src/agent/runtime.ts";
import { AppDatabase } from "../src/db/database.ts";
import { createApp } from "../src/server/app.ts";

// 回归：「停止生成」的回滚失效。
// Web 端点用 init 事件里的 `user_message_id`（`user_<submissionId>`）作为 rollback 的 message_id，
// 而 truncateConversation 只剥离 `msg_` 前缀后就 Number()，`user_1` 得到 NaN → 静默返回 deleted_count: 0。
// 结果：页面本地把用户消息删掉、把文本塞回输入框，随后重新拉取又把这条用户消息放了回来 → 重复。

async function setup() {
  const db = new AppDatabase(":memory:");
  const faux = fauxProvider({
    provider: "faux",
    models: [{ id: "faux-reasoner", name: "Faux Reasoner", reasoning: true }],
    tokensPerSecond: 4,
    tokenSize: { min: 2, max: 4 },
  });
  const runtime = await MemoriaAgentRuntime.create({ db, customProviders: [faux.provider] });
  db.setSetting("default_provider", "faux");
  db.setSetting("llm_model", "faux-reasoner");
  const app = createApp(runtime);
  return { faux, runtime, app };
}

describe("停止生成的回滚", () => {
  it("用 init 事件给出的 user_<submissionId> 回滚时，应真的删掉本轮用户消息", async () => {
    const { faux, runtime, app } = await setup();
    try {
      faux.setResponses([
        fauxAssistantMessage([fauxThinking("思考".repeat(200)), fauxText("回答".repeat(200))]),
      ]);
      const submitRes = await app.request("/api/conversations/new/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "这条消息应该被回滚", modelProvider: "faux", modelId: "faux-reasoner" }),
      });
      const body = (await submitRes.json()) as any;
      const sessionId = body.conversation.id as string;
      // 与 web/src/api.ts 的 streamAgentChat 一致：user_message_id = `user_${submissionId}`
      const userMessageId = `user_${body.submissionId}`;

      await new Promise((r) => setTimeout(r, 120));

      const abortRes = await app.request(`/api/conversations/${sessionId}/abort`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rollback: true, message_id: userMessageId }),
      });
      expect(abortRes.status).toBe(200);

      const msgs = (await (await app.request(`/api/conversations/${sessionId}/messages`)).json()) as any[];
      expect(msgs.map((m) => `${m.role}:${m.content}`)).toEqual([]);
    } finally {
      await runtime.close();
    }
  });
});
