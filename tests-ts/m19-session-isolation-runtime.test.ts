import { describe, expect, it } from "vitest";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxThinking } from "@earendil-works/pi-ai/providers/faux";
import { MemoriaAgentRuntime } from "../src/agent/runtime.ts";
import { AppDatabase } from "../src/db/database.ts";
import { createApp } from "../src/server/app.ts";

// 用真实 runtime 检查：两个会话同时存在时，各自的 /messages 是否互不串台。
// getConversation 用 `id = ? OR CAST(durable_id AS TEXT) = ?` 匹配，
// 一旦某个会话的字符串 id 恰好等于另一个会话的 durable_id，就会串台。

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
  return { faux, runtime, app, db };
}

const submit = async (app: any, content: string) => {
  const res = await app.request("/api/conversations/new/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, modelProvider: "faux", modelId: "faux-reasoner" }),
  });
  return (await res.json()) as any;
};

describe("会话隔离（真实 runtime）", () => {
  it("会话一运行中时，会话二的 /messages 不包含会话一的消息", async () => {
    const { faux, runtime, app, db } = await setup();
    try {
      faux.setResponses([
        fauxAssistantMessage([fauxThinking("思考".repeat(200)), fauxText("回答".repeat(200))]),
        fauxAssistantMessage([fauxText("会话二的回答")]),
      ]);

      const first = await submit(app, "会话一的提问");
      const s1 = first.conversation.id as string;

      // 会话一进入运行中
      await new Promise((r) => setTimeout(r, 120));
      const s1msgs = (await (await app.request(`/api/conversations/${s1}/messages`)).json()) as any[];
      expect(s1msgs.some((m) => m.role === "assistant" && m.status === "streaming")).toBe(true);

      // 列出所有会话，确认 id 形态
      const sessions = (await (await app.request("/api/conversations")).json()) as any[];
      console.log("[probe] sessions =", sessions.map((s) => ({ id: s.id, durableId: s.durableId })));
      console.log("[probe] s1msgs =", s1msgs.map((m) => `${m.id}|${m.role}|${m.status}`));

      // 会话一的运行还在跑；此时创建/打开会话二
      const second = await submit(app, "会话二的提问");
      const s2 = second.conversation.id as string;
      console.log("[probe] s1/s2 =", s1, s2);

      const s2msgs = (await (await app.request(`/api/conversations/${s2}/messages`)).json()) as any[];
      console.log("[probe] s2msgs =", s2msgs.map((m) => `${m.id}|${m.role}|${m.status}|${m.content.slice(0, 10)}`));

      // 会话二里不应出现会话一的任何内容
      expect(s2msgs.some((m) => m.content?.includes("会话一的提问"))).toBe(false);
      expect(s2msgs.every((m) => m.session_id === s2)).toBe(true);

      // 会话一的消息也不应混入会话二的在飞助手消息
      expect(s1msgs.every((m) => m.session_id === s1)).toBe(true);
    } finally {
      await runtime.close();
    }
  });
});
