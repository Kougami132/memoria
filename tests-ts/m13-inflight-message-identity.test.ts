import { describe, expect, it } from "vitest";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxThinking } from "@earendil-works/pi-ai/providers/faux";
import { MemoriaAgentRuntime } from "../src/agent/runtime.ts";
import { AppDatabase } from "../src/db/database.ts";
import { createApp } from "../src/server/app.ts";

// 回归：运行中每轮询一次 /messages，在飞助手消息的身份必须不变。
// 之前用 Date.now() 当 entry id，前端以 id 作 React key，于是每 1.5s 重建一次气泡，
// 展开的 CoT / 执行轨迹被重置为收起。

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

describe("运行中的消息身份稳定性", () => {
  it("轮询在飞助手消息时 id 保持不变", async () => {
    const { faux, runtime, app } = await setup();
    try {
      faux.setResponses([
        fauxAssistantMessage([fauxThinking("思考".repeat(200)), fauxText("回答".repeat(200))]),
      ]);
      const submitRes = await app.request("/api/conversations/new/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "hi", modelProvider: "faux", modelId: "faux-reasoner" }),
      });
      const sessionId = ((await submitRes.json()) as any).conversation.id as string;

      const seen: string[] = [];
      for (let i = 0; i < 5; i++) {
        const msgs = (await (await app.request(`/api/conversations/${sessionId}/messages`)).json()) as any[];
        const last = msgs[msgs.length - 1];
        if (last?.role === "assistant" && last.status === "streaming") seen.push(last.id);
        await new Promise((r) => setTimeout(r, 40));
      }

      expect(seen.length).toBeGreaterThanOrEqual(2);
      expect(new Set(seen).size).toBe(1);
    } finally {
      await runtime.close();
    }
  });
});
