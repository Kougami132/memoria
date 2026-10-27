// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// 回归：会话切换时页面级 UI 状态必须跟着切，不能把上一个会话的残留带过去。
// - 上一个会话的消息在 fetch 回来之前仍显示在新会话里（闪一下别人的对话）
// - 输入框草稿跟着带过去
// - 正在编辑的用户消息也跟过去

const h = vi.hoisted(() => ({
  state: {
    sessions: [] as any[],
    messages: {} as Record<string, any[]>,
    /** 让 getAgentMessages 挂起，模拟慢网络下切换会话的窗口期。 */
    hold: null as null | (() => void),
  },
}));

vi.mock("@/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../web/src/api.ts")>();
  return {
    ...actual,
    listAgentSessions: async () => h.state.sessions,
    listAvailableModels: async () => [],
    listKBs: async () => [],
    listHosts: async () => [],
    getSettings: async () => ({ llm_model: "faux", default_provider: "faux" }),
    getAgentMessages: async (id: string) => {
      if (h.state.hold) {
        await new Promise<void>((resolve) => {
          const prev = h.state.hold!;
          h.state.hold = () => {
            prev();
            resolve();
          };
        });
      }
      return h.state.messages[id] ?? [];
    },
    streamAgentChat: async function* () {},
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
  h.state.sessions = [
    { id: "s1", title: "会话一", thinkingLevel: "medium", scope: null },
    { id: "s2", title: "会话二", thinkingLevel: "medium", scope: null },
  ];
  h.state.messages = {
    s1: [{ id: "msg_1", session_id: "s1", role: "user", content: "A 的提问", created_at: "", sources: [] }],
    s2: [{ id: "msg_10", session_id: "s2", role: "user", content: "B 的提问", created_at: "", sources: [] }],
  };
  h.state.hold = null;
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
});

describe("AgenticChat 会话切换的 UI 状态隔离", () => {
  it("切换会话后不应继续显示上一个会话的消息", async () => {
    renderChat("/agentic-chat/s1");
    await waitForText("A 的提问");

    // 模拟慢网络：B 的消息还没回来
    h.state.hold = () => {};
    await click(byText("会话二")!);
    await flush();

    expect(byText("A 的提问")).toBeNull();

    // 放行并确认 B 的内容到位
    await act(async () => {
      h.state.hold?.();
      h.state.hold = null;
      await new Promise((r) => setTimeout(r, 0));
    });
    await waitForText("B 的提问");
  });

  it("切换会话后不应把上一个会话的输入草稿带过去", async () => {
    renderChat("/agentic-chat/s1");
    await waitForText("A 的提问");

    const textarea = container.querySelector("textarea")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(textarea, "A 的草稿");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe("A 的草稿");

    await click(byText("会话二")!);
    await waitForText("B 的提问");

    expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe("");
  });
});
