// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// 回归：AgenticChat 的页面状态（streamState / messages）没有按会话隔离。
// 1) A 会话流式进行中点开 B 会话，A 的「思考中 / 响应中」仍然渲染在 B 的会话里；
// 2) 回到 A 会话后，流式气泡每 1.5s 轮询一次就被重建（运行时给在飞消息的 id 是 Date.now()），
//    展开的 CoT 被重置为收起。

const h = vi.hoisted(() => {
  const state = {
    sessions: [] as any[],
    messages: {} as Record<string, any[]>,
    queue: [] as any[],
    waiter: null as null | (() => void),
    done: false,
  };
  return {
    state,
    push(ev: any) {
      state.queue.push(ev);
      const w = state.waiter;
      state.waiter = null;
      w?.();
    },
    finish() {
      state.done = true;
      const w = state.waiter;
      state.waiter = null;
      w?.();
    },
    reset() {
      state.sessions = [];
      state.messages = {};
      state.queue = [];
      state.waiter = null;
      state.done = false;
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
    listAgentSessions: async () => h.state.sessions,
    listAvailableModels: async () => [],
    listKBs: async () => [],
    listHosts: async () => [],
    getSettings: async () => ({ llm_model: "faux", default_provider: "faux" }),
    getAgentMessages: async (id: string) => h.state.messages[id] ?? [],
    streamAgentChat: () => fakeStream(),
    submitToConversation: async () => ({ conversation: { id: "s1" }, submissionId: 1, status: "admitted" }),
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

function renderChat(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/agentic-chat/:sessionId" element={<AgenticChat />} />
            <Route path="/agentic-chat" element={<AgenticChat />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
}

/** 在 container 里找出第一个内容恰为 text 的最深元素。 */
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

const sessions = [
  { id: "s1", title: "会话一", thinkingLevel: "medium", scope: null },
  { id: "s2", title: "会话二", thinkingLevel: "medium", scope: null },
];

beforeEach(() => {
  h.reset();
  h.state.sessions = sessions;
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  vi.restoreAllMocks();
});

describe("AgenticChat 跨会话状态隔离", () => {
  it("A 会话流式进行中切到 B 会话时，不应继续显示 A 的思考与响应", async () => {
    h.state.messages = {
      s1: [{ id: "msg_1", session_id: "s1", role: "user", content: "A 的提问", created_at: "", sources: [] }],
      s2: [{ id: "msg_10", session_id: "s2", role: "user", content: "B 的提问", created_at: "", sources: [] }],
    };
    renderChat("/agentic-chat/s1");
    await waitForText("A 的提问");

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
      h.push({ type: "init", session_id: "s1", user_message_id: "user_1" });
      h.push({ type: "thought_delta", delta: "A-思考中" });
      h.push({ type: "answer_delta", delta: "A-响应中" });
      await new Promise((r) => setTimeout(r, 0));
    });

    await waitForText("A-思考中");
    await waitForText("A-响应中");

    // 切到 B 会话
    await click(byText("会话二")!);
    await waitForText("B 的提问");

    expect(byText("A-思考中")).toBeNull();
    expect(byText("A-响应中")).toBeNull();
    expect(byText("助手正在思考与响应中，请稍候...")).toBeNull();
  });

  it("回到仍在运行的 A 会话后，展开 CoT 不应被轮询重建自动收起", async () => {
    h.state.messages = {
      s1: [{ id: "msg_1", session_id: "s1", role: "user", content: "A 的提问", created_at: "", sources: [] }],
    };
    // 与 runtime.formatTranscriptToMessages 一致：在飞消息用本轮 submission 作稳定 id，
    // 只有内容随时间增长，身份不变。
    let grow = 0;
    const api = await import("@/api");
    const getMessages = vi.spyOn(api, "getAgentMessages").mockImplementation(async (id: string) => {
      const base = h.state.messages[id] ?? [];
      grow += 1;
      return [
        ...base,
        {
          id: "inflight_7",
          session_id: id,
          role: "assistant",
          content: "",
          status: "streaming",
          created_at: "",
          sources: [],
          trace: {
            trace_id: "t",
            workflow_name: "pi-durable-agent",
            metadata: { thought: "A-思考中".repeat(grow) },
            spans: [],
            summary: { reasoning: "A-思考中".repeat(grow), total_tokens: 0 },
          },
        },
      ] as any;
    });

    renderChat("/agentic-chat/s1");
    const header = await waitForText("模型思考过程 (CoT)");
    await click(header);
    await waitForText("A-思考中");

    // 等待轮询把消息列表刷新至少两次（轮询间隔 1.5s）
    const started = Date.now();
    while (getMessages.mock.calls.length < 3 && Date.now() - started < 6000) {
      await flush();
    }
    expect(getMessages.mock.calls.length).toBeGreaterThanOrEqual(3);

    // 展开状态必须活过轮询刷新
    const expanded = [...container.querySelectorAll("div")].some((el) =>
      el.className.includes("border-primary/10") && el.textContent?.includes("A-思考中"),
    );
    expect(expanded).toBe(true);
  });

  it("发送消息后立即显示等待占位气泡，新会话路由跳转不闪空用户消息，且自动重试期间展示重试提示", async () => {
    // 初始在 /agentic-chat 新对话页，且后端 /messages 尚未落盘返回空数组
    h.state.messages = { s1: [] };
    renderChat("/agentic-chat");
    await waitForText("你好！我是 AI Agent 助手");

    const textarea = container.querySelector("textarea")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(textarea, "我的nas运行多久了");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      textarea.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    // 1. 尚未收到任何 SSE 事件时，用户气泡与助手等待占位气泡必须立即同时出现
    await waitForText("我的nas运行多久了");
    await waitForText("助手正在思考与响应中，请稍候...");

    // 2. 收到 init 事件跳转到 /agentic-chat/s1（此时 getAgentMessages('s1') 仍返回 []），用户消息与占位气泡不能闪空
    await act(async () => {
      h.push({ type: "init", session_id: "s1", user_message_id: "user_1" });
      await new Promise((r) => setTimeout(r, 0));
    });
    await flush();
    expect(byText("我的nas运行多久了")).not.toBeNull();
    expect(byText("助手正在思考与响应中，请稍候...")).not.toBeNull();

    // 3. 上游连接异常触发自动重试时，占位气泡内实时显示重试状态
    await act(async () => {
      h.push({ type: "retry_status", phase: "start", detail: "Connection error.", retry_attempt: 1 });
      await new Promise((r) => setTimeout(r, 0));
    });
    await waitForText("模型连接异常 (Connection error.)，正在自动重试 (第 1 次)...");

    // 4. 收到回答增量后，占位气泡被真实回答气泡替换
    await act(async () => {
      h.push({ type: "answer_delta", delta: "已连续运行 38 天。" });
      await new Promise((r) => setTimeout(r, 0));
    });
    await waitForText("已连续运行 38 天。");
    expect(byText("助手正在思考与响应中，请稍候...")).toBeNull();
    expect(byText("模型连接异常 (Connection error.)，正在自动重试 (第 1 次)...")).toBeNull();
  });
});
