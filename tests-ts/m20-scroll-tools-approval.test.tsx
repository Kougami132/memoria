// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { MemoriaAgentRuntime } from "../src/agent/runtime.ts";
import { AppDatabase } from "../src/db/database.ts";
import { createApp } from "../src/server/app.ts";

// 复现用户在会话 170（「查看nas状态」）中遇到的三个问题：
// 1) 工具调用里同时有好多的「执行中」：已完成并落盘 pi.tool-result 的工具 span 没有 ended_at，
//    TraceSpanCard 用 `!span.ended_at && !span.error` 判断，所有历史成功工具全部显示「执行中」。
// 2) 点击同意了的审批还会一直出来：
//    a) 用户点「允许执行」后，SSH 命令仍在执行期间（runOnHost 未返回），live.tools[i].details 仍带着
//       approval_id / pending_approval，800ms/1.5s 轮询 /messages 又把同一个 approval_id 作为 pending_approval 返回，
//       已同意的审批卡片再次弹出来；
//    b) 同一轮模型并发发起多个 host_exec 时，前端 streamState 只存单个 pendingApproval，后到的覆盖先到的。
// 3) 会话页面一直往下滚，手动往上滚也会被强制拉下去：
//    每 1.5s 轮询或流式增量都会无条件触发 scrollIntoView，即使用户已经手动上滚查看历史也照拉不误。

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("会话 170 的三个页面问题复现", () => {
  it("问题 1：已完成的工具调用在 /messages 中不应继续显示为「执行中」", async () => {
    const db = new AppDatabase(":memory:");
    const faux = fauxProvider({
      provider: "faux",
      models: [{ id: "faux-reasoner", name: "Faux Reasoner", reasoning: true }],
    });
    let releaseSecondRound!: () => void;
    const secondRoundGate = new Promise<void>((r) => {
      releaseSecondRound = r;
    });
    let callCount = 0;
    const runtime = await MemoriaAgentRuntime.create({
      db,
      customProviders: [faux.provider],
      hostRunner: async (_host, cmd) => {
        callCount += 1;
        if (callCount >= 3) {
          await secondRoundGate;
        }
        return { exitCode: 0, stdout: `executed: ${cmd}`, stderr: "" };
      },
    });
    db.setSetting("default_provider", "faux");
    db.setSetting("llm_model", "faux-reasoner");
    const app = createApp(runtime);

    try {
      const hostRes = await app.request("/api/hosts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "istore",
          host: "10.1.1.1",
          username: "root",
          auth_type: "password",
          credential: "x",
          security_mode: "unrestricted",
        }),
      });
      const host = (await hostRes.json()) as any;

      faux.setResponses([
        // 第一轮：两个工具调用都已完成
        fauxAssistantMessage(
          [
            fauxToolCall("host_exec", { host_id: host.id, command: "uname -a" }, { id: "call_done_1" }),
            fauxToolCall("host_exec", { host_id: host.id, command: "df -h" }, { id: "call_done_2" }),
          ],
          { stopReason: "toolUse" },
        ),
        // 第二轮：第三个工具调用正在执行中
        fauxAssistantMessage(
          [fauxToolCall("host_exec", { host_id: host.id, command: "ping -c 4 192.168.10.6" }, { id: "call_running_3" })],
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage([fauxText("NAS 状态正常")]),
      ]);

      const submitRes = await app.request("/api/conversations/new/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: "查看nas状态",
          modelProvider: "faux",
          modelId: "faux-reasoner",
          scope: { kbIds: [], hostIds: [host.id], hostSecurityModes: {}, webSearch: false, subagentEnabled: true },
        }),
      });
      const sessionId = ((await submitRes.json()) as any).conversation.id as string;

      // 等到进入第二轮（callCount === 3）
      for (let i = 0; i < 80 && callCount < 3; i++) {
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(callCount).toBe(3);

      const msgs = (await (await app.request(`/api/conversations/${sessionId}/messages`)).json()) as any[];
      const asst = msgs.find((m) => m.role === "assistant")!;
      const spans = asst.trace.spans as any[];

      const done1 = spans.find((s) => s.id === "call_done_1")!;
      const done2 = spans.find((s) => s.id === "call_done_2")!;
      const running3 = spans.find((s) => s.id === "call_running_3")!;

      // 已落盘 pi.tool-result 的两个工具必须有 ended_at（前端据此渲染「已完成」而非「执行中」）
      expect(Boolean(done1.ended_at)).toBe(true);
      expect(Boolean(done2.ended_at)).toBe(true);
      // 仍在执行中的第 3 个工具不应有 ended_at
      expect(Boolean(running3.ended_at)).toBe(false);
    } finally {
      releaseSecondRound();
      await runtime.close();
    }
  });

  it("问题 2：点击批准后、SSH 命令仍在执行期间，/messages 不应再次把同一个审批当作 pending_approval 返回", async () => {
    const db = new AppDatabase(":memory:");
    const faux = fauxProvider({
      provider: "faux",
      models: [{ id: "faux-reasoner", name: "Faux Reasoner", reasoning: true }],
    });
    let releaseSsh!: () => void;
    const sshGate = new Promise<void>((r) => {
      releaseSsh = r;
    });
    let sshStarted = false;
    const runtime = await MemoriaAgentRuntime.create({
      db,
      customProviders: [faux.provider],
      hostRunner: async () => {
        sshStarted = true;
        await sshGate;
        return { exitCode: 0, stdout: "ok", stderr: "" };
      },
    });
    db.setSetting("default_provider", "faux");
    db.setSetting("llm_model", "faux-reasoner");
    const app = createApp(runtime);

    try {
      const hostRes = await app.request("/api/hosts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "istore",
          host: "10.1.1.1",
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
          content: "查看日志",
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

      // 用户点击「允许执行」
      const resp = await app.request(`/api/hosts/approvals/${approvalId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approved: true }),
      });
      expect(resp.status).toBe(200);

      // 等 SSH 开始执行（此时命令还在跑，尚未结束）
      for (let i = 0; i < 40 && !sshStarted; i++) {
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(sshStarted).toBe(true);

      // 此时前端轮询 /messages，绝不能再收到 pending_approval（否则审批卡片会再次弹出来）
      const msgs = (await (await app.request(`/api/conversations/${sessionId}/messages`)).json()) as any[];
      const last = msgs[msgs.length - 1];
      expect(last.status).toBe("streaming");
      expect(last.metadata?.approval_id).toBeUndefined();
    } finally {
      releaseSsh();
      await runtime.close();
    }
  });

  it("问题 3：同一轮并发发起两个需审批的 host_exec 时，流式界面不应互相覆盖丢失审批，且逐个批准都能生效", async () => {
    const api = await import("@/api");
    const { AgenticChat } = await import("../web/src/pages/AgenticChat.tsx");

    const queue: any[] = [];
    let waiter: (() => void) | null = null;
    const push = (ev: any) => {
      queue.push(ev);
      const w = waiter;
      waiter = null;
      w?.();
    };

    vi.spyOn(api, "listAgentSessions").mockResolvedValue([
      { id: "170", title: "查看nas状态", thinkingLevel: "high", scope: undefined } as any,
    ]);
    vi.spyOn(api, "listAvailableModels").mockResolvedValue([]);
    vi.spyOn(api, "listKBs").mockResolvedValue([]);
    vi.spyOn(api, "listHosts").mockResolvedValue([]);
    vi.spyOn(api, "getSettings").mockResolvedValue({ llm_model: "faux", default_provider: "faux" } as any);
    vi.spyOn(api, "getAgentMessages").mockResolvedValue([]);
    vi.spyOn(api, "streamAgentChat").mockImplementation(async function* () {
      while (true) {
        if (queue.length === 0) {
          await new Promise<void>((r) => {
            waiter = r;
          });
          continue;
        }
        const next = queue.shift();
        if (next.type === "__end__") return;
        yield next;
      }
    });
    const responded: Array<{ id: string; approved: boolean }> = [];
    vi.spyOn(api, "respondHostApproval").mockImplementation(async (id: string, approved: boolean) => {
      responded.push({ id, approved });
      return { id, status: approved ? "approved" : "rejected", command: "", host_id: "h1" };
    });

    Element.prototype.scrollIntoView = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    try {
      act(() => {
        root.render(
          <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={["/agentic-chat/170"]}>
              <Routes>
                <Route path="/agentic-chat/:sessionId" element={<AgenticChat />} />
              </Routes>
            </MemoryRouter>
          </QueryClientProvider>,
        );
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });

      const textarea = container.querySelector("textarea")!;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      await act(async () => {
        setter.call(textarea, "查看nas状态");
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => {
        textarea.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });

      // 同一轮并发推入两个 approval_required
      await act(async () => {
        push({ type: "init", session_id: "170", user_message_id: "user_1" });
        push({
          type: "approval_required",
          approval_id: "appr_first",
          host_id: "h1",
          host_name: "istore",
          command: "uname -a",
        });
        push({
          type: "approval_required",
          approval_id: "appr_second",
          host_id: "h1",
          host_name: "istore",
          command: "ip neigh",
        });
        await new Promise((r) => setTimeout(r, 0));
      });

      // 批准第一个后，第二个还应该在界面上，最终两个都能被批准
      const clickApprove = async () => {
        const btn = [...container.querySelectorAll("button")].find((b) =>
          b.textContent?.includes("允许执行"),
        );
        expect(btn).toBeTruthy();
        await act(async () => {
          btn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        });
      };

      await clickApprove();
      await clickApprove();

      expect(responded.map((r) => r.id).sort()).toEqual(["appr_first", "appr_second"]);
    } finally {
      push({ type: "__end__" });
      act(() => root.unmount());
      container.remove();
      vi.restoreAllMocks();
    }
  });

  it("问题 4：用户手动往上滚查看历史时，轮询或流式刷新不应强制拉回底部", async () => {
    const api = await import("@/api");
    const { AgenticChat } = await import("../web/src/pages/AgenticChat.tsx");

    let pollCount = 0;
    vi.spyOn(api, "listAgentSessions").mockResolvedValue([
      { id: "170", title: "查看nas状态", thinkingLevel: "high", scope: undefined } as any,
    ]);
    vi.spyOn(api, "listAvailableModels").mockResolvedValue([]);
    vi.spyOn(api, "listKBs").mockResolvedValue([]);
    vi.spyOn(api, "listHosts").mockResolvedValue([]);
    vi.spyOn(api, "getSettings").mockResolvedValue({ llm_model: "faux", default_provider: "faux" } as any);
    vi.spyOn(api, "getAgentMessages").mockImplementation(async () => {
      pollCount += 1;
      return [
        { id: "msg_1", session_id: "170", role: "user", content: "查看nas状态", created_at: "", sources: [] },
        {
          id: "inflight_1",
          session_id: "170",
          role: "assistant",
          content: "",
          status: "streaming",
          created_at: "",
          sources: [],
          trace: {
            trace_id: "t",
            workflow_name: "w",
            metadata: {},
            spans: [],
            summary: { reasoning: `思考中-${pollCount}`, span_count: 0, tool_count: 0, model_count: 1, error_count: 0 },
          },
        },
      ] as any;
    });

    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    try {
      act(() => {
        root.render(
          <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={["/agentic-chat/170"]}>
              <Routes>
                <Route path="/agentic-chat/:sessionId" element={<AgenticChat />} />
              </Routes>
            </MemoryRouter>
          </QueryClientProvider>,
        );
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      // 找到消息滚动容器，模拟用户手动上滚（远离底部）
      const scrollBox = container.querySelector(".overflow-y-auto.p-4") as HTMLElement;
      expect(scrollBox).toBeTruthy();
      Object.defineProperty(scrollBox, "scrollHeight", { value: 2000, configurable: true });
      Object.defineProperty(scrollBox, "clientHeight", { value: 500, configurable: true });
      Object.defineProperty(scrollBox, "scrollTop", { value: 300, writable: true, configurable: true });
      await act(async () => {
        scrollBox.dispatchEvent(new Event("scroll", { bubbles: true }));
      });

      scrollSpy.mockClear();

      // 等待下一次 1.5s 轮询返回
      const before = pollCount;
      const started = Date.now();
      while (pollCount <= before && Date.now() - started < 4000) {
        await act(async () => {
          await new Promise((r) => setTimeout(r, 50));
        });
      }
      expect(pollCount).toBeGreaterThan(before);

      // 用户已经上滚，绝不能被强制 scrollIntoView 拉回底部
      expect(scrollSpy).not.toHaveBeenCalled();
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.restoreAllMocks();
    }
  });
});
