// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// 回归：审批挂起时刷新 / 重新进入会话，审批卡片必须还能点。
// 后端曾把在飞轮次一律标成 streaming 且不给 metadata，页面只剩「思考与响应中」，
// 用户无从批准，只能等 5 分钟审批超时。

const h = vi.hoisted(() => ({
  state: { messages: [] as any[], responded: [] as Array<{ id: string; approved: boolean }> },
}));

vi.mock("@/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../web/src/api.ts")>();
  return {
    ...actual,
    listAgentSessions: async () => [{ id: "s1", title: "会话一", thinkingLevel: "medium", scope: null }],
    listAvailableModels: async () => [],
    listKBs: async () => [],
    listHosts: async () => [],
    getSettings: async () => ({ llm_model: "faux", default_provider: "faux" }),
    getAgentMessages: async () => h.state.messages,
    streamAgentChat: async function* () {},
    respondHostApproval: async (id: string, approved: boolean) => {
      h.state.responded.push({ id, approved });
    },
  };
});

const { AgenticChat } = await import("../web/src/pages/AgenticChat.tsx");

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement;

const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

function byText(text: string): HTMLElement | null {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let best: HTMLElement | null = null;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.textContent?.trim() === text && node.parentElement) best = node.parentElement;
  }
  return best;
}

async function waitForText(text: string, timeout = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const el = byText(text);
    if (el) return el;
    await flush();
  }
  throw new Error(`未找到文本: ${text}\n当前 DOM:\n${container.textContent}`);
}

beforeEach(() => {
  h.state.responded = [];
  h.state.messages = [
    { id: "msg_1", session_id: "s1", role: "user", content: "重启 nginx", created_at: "", sources: [] },
    {
      id: "inflight_9",
      session_id: "s1",
      role: "assistant",
      content: "",
      status: "pending_approval",
      created_at: "",
      sources: [],
      metadata: {
        approval_id: "appr_abc123",
        host_id: "host_1",
        host_name: "prod-node",
        command: "systemctl restart nginx",
      },
    },
  ];
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
});

describe("审批挂起状态恢复", () => {
  it("重新进入会话时应直接渲染审批卡片并可批准", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={["/agentic-chat/s1"]}>
            <Routes>
              <Route path="/agentic-chat/:sessionId" element={<AgenticChat />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });

    await waitForText("主机操作执行审批请求");
    await waitForText("systemctl restart nginx");

    await act(async () => {
      byText("允许执行")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(h.state.responded).toEqual([{ id: "appr_abc123", approved: true }]);
  });
});
