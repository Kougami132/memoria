import { describe, expect, it } from "vitest";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxThinking } from "@earendil-works/pi-ai/providers/faux";
import { MemoriaAgentRuntime } from "../src/agent/runtime.ts";
import { AppDatabase } from "../src/db/database.ts";
import { createApp } from "../src/server/app.ts";
import { createStreamTextReconciler } from "../web/src/api.ts";

// 回归：Web 端曾只消费 message_update 的 *_delta，丢弃 message_start / block / message / message_end
// 携带的权威全文，导致「模型思考过程 (CoT)」与回答丢失开头（首帧 partial 已含内容时整段消失），
// 以及末尾被节流的 partial 提交吞掉。这里驱动真实 SSE 流，断言归约结果与落库记录逐字一致。

// tokensPerSecond 为空时 faux 一次性吐出整条消息（首帧 partial 即含全文）；
// 限速时 partial 提交真的按 partialIntervalMs 节流，从而复现「最后一段 delta 丢失」。
async function setup(tokensPerSecond?: number) {
  const db = new AppDatabase(":memory:");
  const faux = fauxProvider({
    provider: "faux",
    models: [{ id: "faux-reasoner", name: "Faux Reasoner", reasoning: true }],
    ...(tokensPerSecond ? { tokensPerSecond, tokenSize: { min: 2, max: 4 } } : {}),
  });
  const runtime = await MemoriaAgentRuntime.create({ db, customProviders: [faux.provider] });
  db.setSetting("default_provider", "faux");
  db.setSetting("llm_model", "faux-reasoner");
  const app = createApp(runtime);

  const submit = async (content: string) => {
    const res = await app.request("/api/conversations/new/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, modelProvider: "faux", modelId: "faux-reasoner" }),
    });
    return ((await res.json()) as any).conversation.id as string;
  };

  // 消费真实 SSE 流，返回 Web 端会渲染出的 thought / answer。
  const streamUi = async (sessionId: string) => {
    const res = await app.request(`/api/conversations/${sessionId}/events`, {
      headers: { Accept: "text/event-stream" },
    });
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const timer = setTimeout(() => void reader.cancel(), 15000);
    const text = createStreamTextReconciler();
    let thought = "";
    let answer = "";
    // 与 AgenticChat.tsx 的消费方式一致：replace 整体替换，否则追加。
    const apply = () => {
      for (const ev of text.reconcile()) {
        if (ev.type === "thought_delta") thought = ev.replace ? ev.delta! : thought + ev.delta!
        else if (ev.type === "answer_delta") answer = ev.replace ? ev.delta! : answer + ev.delta!
      }
    };
    try {
      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith("data:")) continue;
          const dataStr = line.slice(5).trim();
          if (!dataStr) continue;
          const ev = JSON.parse(dataStr);
          if (ev.type === "snapshot") {
            text.loadBlocks(ev.snapshot?.generation?.message);
            apply();
            if (!ev.snapshot?.run && !ev.snapshot?.generation && (!ev.snapshot?.tools || ev.snapshot.tools.length === 0)) break outer;
          } else if (ev.type === "message_start") {
            text.loadBlocks(ev.message);
            apply();
          } else if (ev.type === "message_update" && Array.isArray(ev.changes)) {
            text.applyChanges(ev.changes);
            apply();
          } else if (ev.type === "message_end") {
            text.loadBlocks(ev.entry?.model?.[0]);
            apply();
            text.commit();
          } else if (ev.type === "run_end") {
            break outer;
          }
        }
      }
    } finally {
      clearTimeout(timer);
    }
    return { thought, answer };
  };

  const persisted = async (sessionId: string) => {
    const res = await app.request(`/api/conversations/${sessionId}/messages`);
    return (await res.json()) as any[];
  };

  return { faux, runtime, submit, streamUi, persisted };
}

const THINKING =
  "用户要求查看 NAS 状态。已挂载的受控主机是 iStoreOS 路由器。NAS 可能是局域网中的另一台设备。先执行一些诊断命令。注意 mode=ask_confirmation，需要用户确认执行。";
const ANSWER = "我来检查这台主机（iStoreOS 路由器）的状态，以及它能否发现局域网内的 NAS 设备。";

describe("Web 流式 CoT/回答：与落库记录逐字一致", () => {
  it("首帧 partial 已含全文时不丢开头", async () => {
    const { faux, runtime, submit, streamUi, persisted } = await setup();
    try {
      faux.setResponses([fauxAssistantMessage([fauxThinking(THINKING), fauxText(ANSWER)])]);
      const sessionId = await submit("查看nas状态");
      const ui = await streamUi(sessionId);
      const assistant = (await persisted(sessionId)).find((m) => m.role === "assistant" && m.content);

      expect(assistant.trace.summary.reasoning).toBe(THINKING);
      expect(assistant.content).toBe(ANSWER);
      expect(ui.thought).toBe(THINKING);
      expect(ui.answer).toBe(ANSWER);
    } finally {
      await runtime.close();
    }
  });

  it("末尾被节流的 partial 提交不吞掉最后一段回答", async () => {
    const { faux, runtime, submit, streamUi, persisted } = await setup(40);
    try {
      faux.setResponses([fauxAssistantMessage([fauxThinking(THINKING), fauxText(ANSWER)])]);
      const sessionId = await submit("查看nas状态");
      const ui = await streamUi(sessionId);
      const assistant = (await persisted(sessionId)).find((m) => m.role === "assistant" && m.content);

      expect(ui.thought).toBe(assistant.trace.summary.reasoning);
      expect(ui.answer).toBe(assistant.content);
    } finally {
      await runtime.close();
    }
  });
});
