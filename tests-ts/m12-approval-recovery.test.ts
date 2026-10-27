import { describe, expect, it } from "vitest";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { MemoriaAgentRuntime } from "../src/agent/runtime.ts";
import { AppDatabase } from "../src/db/database.ts";
import { createApp } from "../src/server/app.ts";

// 回归：审批挂起期间刷新页面 / 重新进入会话后，审批卡片必须还在。
// 落库消息目前把在飞轮次一律标成 status="streaming" 且没有 metadata，
// 于是 /messages 拉不到 approval_id，页面只剩「助手正在思考与响应中」，用户无法批准 → 卡到 5 分钟审批超时。

async function setup() {
  const db = new AppDatabase(":memory:");
  const faux = fauxProvider({
    provider: "faux",
    models: [{ id: "faux-reasoner", name: "Faux Reasoner", reasoning: true }],
  });
  const runtime = await MemoriaAgentRuntime.create({
    db,
    customProviders: [faux.provider],
    hostRunner: async () => ({ exitCode: 0, stdout: "ok", stderr: "" }),
  });
  db.setSetting("default_provider", "faux");
  db.setSetting("llm_model", "faux-reasoner");
  const app = createApp(runtime);
  return { faux, runtime, app };
}

describe("审批挂起状态的可恢复性", () => {
  it("审批挂起时 /messages 应给出 pending_approval 与 approval_id", async () => {
    const { faux, runtime, app } = await setup();
    try {
      const hostRes = await app.request("/api/hosts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "probe-host",
          host: "10.0.0.9",
          username: "root",
          auth_type: "password",
          credential: "x",
          security_mode: "ask_confirmation",
        }),
      });
      const host = (await hostRes.json()) as any;

      faux.setResponses([
        fauxAssistantMessage(
          [fauxToolCall("host_exec", { host_id: host.id, command: "systemctl restart nginx" }, { id: "call_1" })],
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage([fauxText("done")]),
      ]);

      const submitRes = await app.request("/api/conversations/new/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: "重启 nginx",
          modelProvider: "faux",
          modelId: "faux-reasoner",
          scope: { kbIds: [], hostIds: [host.id], hostSecurityModes: {}, webSearch: false, subagentEnabled: true },
        }),
      });
      const sessionId = ((await submitRes.json()) as any).conversation.id as string;

      let approvalId = "";
      for (let i = 0; i < 60; i++) {
        const pending = runtime.hostManager.approvalManager.listPendingApprovals();
        if (pending.length > 0) {
          approvalId = pending[0].id;
          break;
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(approvalId).toMatch(/^appr_/);

      // 模拟刷新页面：只走 /messages（轮询路径）
      const msgs = (await (await app.request(`/api/conversations/${sessionId}/messages`)).json()) as any[];
      const last = msgs[msgs.length - 1];
      expect(last.role).toBe("assistant");
      expect(last.status).toBe("pending_approval");
      expect(last.metadata?.approval_id).toBe(approvalId);
      expect(last.metadata?.command).toBe("systemctl restart nginx");
    } finally {
      await runtime.close();
    }
  });
});
