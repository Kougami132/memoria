// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// 冒烟：各页面在「后端刚起、几乎没数据」时不应崩溃。
// 这类空态崩溃是页面级 bug 的高发区，比逐条读代码更快暴露问题。

const empty = vi.hoisted(() => {
  const ok = async (v: unknown) => v;
  return {
    ok,
    // 常见空态：空列表 / 空对象
    list: async () => [],
    obj: async () => ({}),
  };
});

vi.mock("@/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../web/src/api.ts")>();
  const stubbed: Record<string, unknown> = { ...actual };
  // 所有请求都回空值：list* 给 []，get* 给 {}，其余 undefined。
  const emptyCall = (key: string) => async () =>
    key.startsWith("list") ? [] : key.startsWith("get") ? {} : undefined;
  for (const [key, value] of Object.entries(actual)) {
    if (typeof value === "function") {
      stubbed[key] = emptyCall(key);
    } else if (value && typeof value === "object") {
      // 如 logsApi：一组同构的请求方法
      const group: Record<string, unknown> = {};
      for (const name of Object.keys(value as Record<string, unknown>)) {
        group[name] = emptyCall(name);
      }
      stubbed[key] = group;
    }
  }
  return stubbed;
});

const pages = {
  AgenticChat: (await import("../web/src/pages/AgenticChat.tsx")).AgenticChat,
  KnowledgeBases: (await import("../web/src/pages/KnowledgeBases.tsx")).default,
  Hosts: (await import("../web/src/pages/Hosts.tsx")).default,
  Logs: (await import("../web/src/pages/Logs.tsx")).default,
  Settings: (await import("../web/src/pages/Settings.tsx")).default,
  About: (await import("../web/src/pages/About.tsx")).default,
};

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement;
const errors: unknown[] = [];

beforeEach(() => {
  errors.length = 0;
  Element.prototype.scrollIntoView = vi.fn();
  vi.spyOn(console, "error").mockImplementation((...args) => {
    errors.push(args);
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  vi.restoreAllMocks();
});

describe("页面空态冒烟", () => {
  for (const [name, Page] of Object.entries(pages)) {
    it(`${name} 在空数据下不应崩溃`, async () => {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      act(() => {
        root!.render(
          <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={["/"]}>
              <Routes>
                <Route path="*" element={<Page />} />
              </Routes>
            </MemoryRouter>
          </QueryClientProvider>,
        );
      });
      // 让 query / effect 落地
      for (let i = 0; i < 3; i++) {
        await act(async () => {
          await new Promise((r) => setTimeout(r, 0));
        });
      }

      expect(container.textContent).not.toBe("");
      // 渲染期抛错会被 React 记到 console.error
      const rendered = errors.filter((e) =>
        String((e as unknown[])[0] ?? "").includes("not wrapped in act") === false,
      );
      expect(rendered).toEqual([]);
    });
  }
});
