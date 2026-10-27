// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// 回归：流式进行中离开 AgenticChat（切到别的页面）时，事件流必须被关掉。
// 否则每次离开都留一条挂着的 SSE 连接，服务端 watchEvents 也一直醒着。

const h = vi.hoisted(() => ({
  state: {
    signal: null as AbortSignal | null,
    closed: false,
  },
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
    getAgentMessages: async () => [],
    streamAgentChat: async function* (
      _text: string,
      _sessionId: string | undefined,
      signal: AbortSignal,
    ): AsyncGenerator<any> {
      h.state.signal = signal;
      yield { type: "init", session_id: "s1", user_message_id: "user_1" };
      // 一直挂着，直到被 abort
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => {
          h.state.closed = true;
          resolve();
        });
      });
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

beforeEach(() => {
  h.state.signal = null;
  h.state.closed = false;
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
});

const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

describe("AgenticChat 卸载", () => {
  it("流式进行中离开页面应关闭事件流", async () => {
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
    await flush();

    // 发一条消息把流跑起来
    const textarea = container.querySelector("textarea")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(textarea, "继续");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      textarea.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flush();
    expect(h.state.signal).not.toBeNull();

    // 离开页面
    act(() => root!.unmount());
    root = null;
    await flush();

    expect(h.state.closed).toBe(true);
  });
});
