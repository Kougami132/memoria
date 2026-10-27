// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// 端到端复现用户描述：
// 1) 在「会话一」发消息，正在思考；
// 2) 点侧边栏「会话二」；
// 3) 会话二里不应出现会话一的「正在思考」气泡。

const h = vi.hoisted(() => {
  const state = {
    queue: [] as any[],
    waiter: null as null | (() => void),
    done: false,
    /** 模拟真实后端：会话一的在飞助手消息会随轮询返回，status=streaming。 */
    s1Messages: [] as any[],
  };
  return {
    state,
    push(ev: any) {
      state.queue.push(ev);
      const w = state.waiter;
      state.waiter = null;
      w?.();
    },
    reset() {
      state.queue = [];
      state.waiter = null;
      state.done = false;
      state.s1Messages = [];
    },
  };
});

async function* fakeStream(): AsyncGenerator<any> {
  while (true) {
    if (h.state.queue.length === 0) {
      if (h.state.done) return;
      await new Promise<void>((resolve) => {
        h.state.waiter = resolve;
      });
      continue;
    }
    yield h.state.queue.shift();
  }
}

vi.mock("@/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../web/src/api.ts")>();
  return {
    ...actual,
    listAgentSessions: async () => [
      { id: "1", title: "会话一", thinkingLevel: "medium", scope: null },
      { id: "2", title: "会话二", thinkingLevel: "medium", scope: null },
    ],
    listAvailableModels: async () => [],
    listKBs: async () => [],
    listHosts: async () => [],
    getSettings: async () => ({ llm_model: "faux", default_provider: "faux" }),
    getAgentMessages: async (id: string) => {
      if (id === "1") return h.state.s1Messages;
      return [{ id: "msg_20", session_id: "2", role: "user", content: "会话二的提问", created_at: "", sources: [] }];
    },
    streamAgentChat: () => fakeStream(),
    submitToConversation: async () => ({ conversation: { id: "1" }, submissionId: 1, status: "admitted" }),
    respondHostApproval: async () => undefined,
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

function byText(text: string): HTMLElement | null {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let best: HTMLElement | null = null;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.textContent?.trim() === text && node.parentElement) best = node.parentElement;
  }
  return best;
}

const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

async function waitForText(text: string, timeout = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const el = byText(text);
    if (el) return el;
    await flush();
  }
  throw new Error(`未找到文本: ${text}\n当前 DOM:\n${container.textContent}`);
}

const click = async (el: HTMLElement) => {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
};

beforeEach(() => {
  h.reset();
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
});

describe("端到端：会话一思考中时切到会话二", () => {
  it("会话二里不应出现会话一的思考气泡", async () => {
    h.state.s1Messages = [
      { id: "msg_1", session_id: "1", role: "user", content: "会话一的提问", created_at: "", sources: [] },
    ];

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={["/agentic-chat/1"]}>
            <Routes>
              <Route path="/agentic-chat/:sessionId" element={<AgenticChat />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });

    await waitForText("会话一的提问");

    // 发一条消息，进入思考中
    const textarea = container.querySelector("textarea")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(textarea, "继续");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      textarea.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await act(async () => {
      h.push({ type: "init", session_id: "1", user_message_id: "user_1" });
      h.push({ type: "thought_delta", delta: "会话一-思考中" });
      await new Promise((r) => setTimeout(r, 0));
    });
    await waitForText("会话一-思考中");

    // 后端此时也会在 /messages 里返回这条在飞消息
    h.state.s1Messages = [
      ...h.state.s1Messages,
      {
        id: "inflight_1",
        session_id: "1",
        role: "assistant",
        content: "",
        status: "streaming",
        created_at: "",
        sources: [],
        trace: { trace_id: "t", workflow_name: "w", metadata: {}, spans: [], summary: {} },
      },
    ];

    // 切到会话二
    await click(byText("会话二")!);
    await waitForText("会话二的提问");

    // 关键：切过去之后，会话一的流仍在继续推事件（真实场景就是这样）
    await act(async () => {
      h.push({ type: "thought_delta", delta: "会话一-继续思考" });
      h.push({ type: "answer_delta", delta: "会话一-部分回答" });
      h.push({ type: "trace_span", phase: "start", span: { id: "sp1", type: "tool", name: "kb_search" } });
      await new Promise((r) => setTimeout(r, 0));
    });
    await flush();

    expect(byText("会话一-思考中")).toBeNull();
    expect(byText("会话一-继续思考")).toBeNull();
    expect(byText("会话一-部分回答")).toBeNull();
    expect(byText("助手正在思考与响应中，请稍候...")).toBeNull();
  });
});
