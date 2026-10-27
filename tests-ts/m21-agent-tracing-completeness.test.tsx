// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxThinking,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { MemoriaAgentRuntime } from "../src/agent/runtime.ts";
import { AppDatabase } from "../src/db/database.ts";
import { createApp } from "../src/server/app.ts";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("Agent Tracing 完整性回归测试（LLM generation、新工具映射、耗时、流式轨迹与 Subagent 透传）", () => {
  it("1) 纯 LLM 轮次与工具轮次：/messages 应包含完整 generation span（含 usage/duration_ms/input/output）及工具专家归属", async () => {
    const db = new AppDatabase(":memory:");
    const faux = fauxProvider({
      provider: "faux",
      models: [{ id: "faux-reasoner", name: "Faux Reasoner", reasoning: true }],
    });
    const runtime = await MemoriaAgentRuntime.create({
      db,
      customProviders: [faux.provider],
      hostRunner: async () => ({ exitCode: 0, stdout: "Linux istore 6.1", stderr: "" }),
    });
    db.setSetting("default_provider", "faux");
    db.setSetting("llm_model", "faux-reasoner");
    const app = createApp(runtime);

    try {
      const host = runtime.hostManager.createHost({
        name: "istore",
        host: "10.0.0.1",
        username: "root",
        auth_type: "password",
        credential: "secret",
        security_mode: "unrestricted",
      });

      // 第一轮：纯 LLM 回答（无工具调用）
      faux.setResponses([
        fauxAssistantMessage([fauxThinking("先思考用户问候"), fauxText("你好！我是 Memoria Agent。")]),
      ]);
      const res1 = await app.request("/api/conversations/new/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: "你好",
          modelProvider: "faux",
          modelId: "faux-reasoner",
          wait: true,
        }),
      });
      const body1 = (await res1.json()) as any;
      const sessionId = body1.conversation.id as string;
      const asst1 = body1.messages.find((m: any) => m.role === "assistant");

      expect(asst1.trace).toBeTruthy();
      expect(asst1.trace.spans.length).toBe(1);
      const genSpan1 = asst1.trace.spans[0];
      expect(genSpan1.type).toBe("generation");
      expect(genSpan1.name).toBe("faux-reasoner");
      expect(genSpan1.agent_id).toBe("orchestrator");
      expect(genSpan1.agent_name).toBe("Orchestrator");
      expect(genSpan1.usage?.total_tokens).toBeGreaterThan(0);
      expect(typeof genSpan1.duration_ms).toBe("number");
      expect(Boolean(genSpan1.started_at)).toBe(true);
      expect(Boolean(genSpan1.ended_at)).toBe(true);
      expect(genSpan1.data?.input).toBeTruthy();
      expect(genSpan1.data?.output).toMatchObject({
        thought: "先思考用户问候",
        content: "你好！我是 Memoria Agent。",
      });
      expect(typeof asst1.trace.summary.duration_ms).toBe("number");
      expect(asst1.trace.summary.model_count).toBe(1);
      expect(asst1.trace.summary.span_count).toBe(1);

      // 第二轮：LLM 决策 -> host_exec -> LLM 汇总
      faux.setResponses([
        fauxAssistantMessage(
          [
            fauxThinking("需要先在主机上执行 uname -a"),
            fauxToolCall("host_exec", { host_id: host.id, command: "uname -a" }, { id: "call_host_1" }),
          ],
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage([fauxThinking("拿到内核版本"), fauxText("主机内核为 Linux istore 6.1。")]),
      ]);

      const res2 = await app.request(`/api/conversations/${sessionId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: "查看主机内核",
          modelProvider: "faux",
          modelId: "faux-reasoner",
          scope: { kbIds: [], hostIds: [host.id], hostSecurityModes: {}, webSearch: false, subagentEnabled: true },
          wait: true,
        }),
      });
      const body2 = (await res2.json()) as any;
      const asst2 = body2.messages[body2.messages.length - 1];

      expect(asst2.trace.spans.map((s: any) => s.type)).toEqual(["generation", "tool", "generation"]);
      expect(asst2.trace.spans[0].data?.output?.tool_calls?.[0]?.name).toBe("host_exec");
      expect(asst2.trace.spans[1]).toMatchObject({
        id: "call_host_1",
        type: "tool",
        name: "host_exec",
        agent_id: "host_agent",
        agent_name: "HostAgent",
      });
      expect(asst2.trace.spans[2].type).toBe("generation");
      expect(asst2.trace.spans[2].data?.output?.content).toBe("主机内核为 Linux istore 6.1。");
      expect(asst2.trace.summary.model_count).toBe(2);
      expect(asst2.trace.summary.tool_count).toBe(1);
      expect(asst2.trace.summary.span_count).toBe(3);
    } finally {
      await runtime.close();
    }
  });

  it("2) SSE 流式 streamAgentChat：应实时产出 generation 的 start/end trace_span 与 usage，以及工具专家角色", async () => {
    const db = new AppDatabase(":memory:");
    const faux = fauxProvider({
      provider: "faux",
      models: [{ id: "faux-reasoner", name: "Faux Reasoner", reasoning: true }],
      tokensPerSecond: 80,
      tokenSize: { min: 3, max: 6 },
    });
    const runtime = await MemoriaAgentRuntime.create({
      db,
      customProviders: [faux.provider],
      hostRunner: async () => ({ exitCode: 0, stdout: "uptime 10 days", stderr: "" }),
    });
    db.setSetting("default_provider", "faux");
    db.setSetting("llm_model", "faux-reasoner");
    const app = createApp(runtime);

    const origFetch = globalThis.fetch;
    globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      return app.request(url, init);
    };

    try {
      const host = runtime.hostManager.createHost({
        name: "istore",
        host: "10.0.0.1",
        username: "root",
        auth_type: "password",
        credential: "secret",
        security_mode: "unrestricted",
      });

      faux.setResponses([
        fauxAssistantMessage(
          [
            fauxThinking("先检查运行时间"),
            fauxToolCall("host_exec", { host_id: host.id, command: "uptime" }, { id: "call_up_1" }),
          ],
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage([fauxThinking("已获取运行时间"), fauxText("已稳定运行 10 天。")]),
      ]);

      const { streamAgentChat } = await import("../web/src/api.ts");
      const events: any[] = [];
      for await (const ev of streamAgentChat("检查运行时间", undefined, undefined, {
        modelProvider: "faux",
        modelId: "faux-reasoner",
        scope: { kbIds: [], hostIds: [host.id], hostSecurityModes: {}, webSearch: false, subagentEnabled: true },
      })) {
        events.push(ev);
      }

      const spanEvents = events.filter((e) => e.type === "trace_span");
      const genStarts = spanEvents.filter((e) => e.span?.type === "generation" && e.phase === "start");
      expect(genStarts.length).toBeGreaterThanOrEqual(2);
      for (const gs of genStarts) {
        expect(Array.isArray(gs.span.data?.input)).toBe(true);
        expect(gs.span.data.input.some((m: any) => m.role === "user" && m.content === "检查运行时间")).toBe(true);
      }

      const genEnds = spanEvents.filter((e) => e.span?.type === "generation" && e.phase === "end");
      expect(genEnds.length).toBe(2);
      expect(genEnds[0].span.name).toBe("faux-reasoner");
      expect(genEnds[0].span.usage?.total_tokens).toBeGreaterThan(0);
      expect(typeof genEnds[0].span.duration_ms).toBe("number");
      expect(Array.isArray(genEnds[0].span.data?.input)).toBe(true);
      expect(genEnds[0].span.data.input.some((m: any) => m.role === "user" && m.content === "检查运行时间")).toBe(true);

      // 第二轮 LLM 调用在执行中（phase=start）与结束（phase=end）时，input 均应包含上一轮 assistant tool_calls 与 tool 输出
      const secondGenId = genEnds[1].span.id;
      const secondGenStart = genStarts.find((e) => e.span.id === secondGenId);
      expect(secondGenStart).toBeTruthy();
      expect(secondGenStart.span.data?.input?.some((m: any) => m.role === "assistant" && Array.isArray(m.tool_calls))).toBe(true);
      expect(secondGenStart.span.data?.input?.some((m: any) => m.role === "tool" && m.content === "uptime 10 days")).toBe(true);
      expect(genEnds[1].span.data?.input?.some((m: any) => m.role === "tool" && m.content === "uptime 10 days")).toBe(true);

      const toolEnd = spanEvents.find((e) => e.span?.type === "tool" && e.phase === "end");
      expect(toolEnd?.span).toMatchObject({
        id: "call_up_1",
        name: "host_exec",
        agent_id: "host_agent",
        agent_name: "HostAgent",
      });
    } finally {
      globalThis.fetch = origFetch;
      await runtime.close();
    }
  });

  it("3) delegate_subagent：子会话的内部执行轨迹、Token 消耗与检索引用来源应透传回父会话", async () => {
    const db = new AppDatabase(":memory:");
    const faux = fauxProvider({
      provider: "faux",
      models: [{ id: "faux-reasoner", name: "Faux Reasoner", reasoning: true }],
    });
    const runtime = await MemoriaAgentRuntime.create({ db, customProviders: [faux.provider] });
    db.setSetting("default_provider", "faux");
    db.setSetting("llm_model", "faux-reasoner");
    const app = createApp(runtime);

    try {
      const kb = db.createKB({ name: "架构文档库", description: "系统架构" });
      await runtime.pipeline.ingest({
        kbId: kb.id,
        filename: "redis-ha.md",
        contentBuffer: Buffer.from("Redis 哨兵模式故障转移超时时间默认为 30 秒。"),
        source: "upload",
      });

      faux.setResponses([
        // 父 Agent 委派给 Subagent
        fauxAssistantMessage(
          [
            fauxThinking("委派子智能体检索 Redis 哨兵配置"),
            fauxToolCall("delegate_subagent", { task: "检索 Redis 哨兵故障转移超时时间" }, { id: "call_sub_kb" }),
          ],
          { stopReason: "toolUse" },
        ),
        // 子智能体调用 kb_search
        fauxAssistantMessage(
          [
            fauxThinking("在知识库中搜索 Redis 哨兵"),
            fauxToolCall("kb_search", { query: "Redis 哨兵 故障转移 超时" }, { id: "sub_call_kb_1" }),
          ],
          { stopReason: "toolUse" },
        ),
        // 子智能体给出结论
        fauxAssistantMessage([fauxText("根据 redis-ha.md，哨兵默认故障转移超时为 30 秒。")]),
        // 父 Agent 汇总最终回答
        fauxAssistantMessage([fauxText("经核实，Redis 哨兵默认故障转移超时为 30 秒。")]),
      ]);

      const res = await app.request("/api/conversations/new/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: "Redis 哨兵故障转移超时是多久？",
          modelProvider: "faux",
          modelId: "faux-reasoner",
          scope: { kbIds: [kb.id], hostIds: [], hostSecurityModes: {}, webSearch: false, subagentEnabled: true },
          wait: true,
        }),
      });
      const body = (await res.json()) as any;
      const asst = body.messages.find((m: any) => m.role === "assistant");

      // 子会话检索到的知识库引用应汇总到父消息 sources
      expect(asst.sources.length).toBeGreaterThan(0);
      expect(asst.sources[0].filename).toBe("redis-ha.md");

      // delegate_subagent 工具 span 应带有子会话的 usage 与内部子步骤 spans
      const subSpan = asst.trace.spans.find((s: any) => s.name === "delegate_subagent");
      expect(subSpan).toBeTruthy();
      expect(subSpan.usage?.total_tokens).toBeGreaterThan(0);
      const childSpans = subSpan.data?.details?.spans as any[];
      expect(Array.isArray(childSpans)).toBe(true);
      const childGenSpans = childSpans.filter((s) => s.type === "generation");
      expect(childGenSpans.length).toBeGreaterThan(0);
      for (const cg of childGenSpans) {
        expect(Array.isArray(cg.data?.input)).toBe(true);
        expect(cg.data.input.some((m: any) => m.role === "user" && m.content === "检索 Redis 哨兵故障转移超时时间")).toBe(true);
      }
      expect(childSpans.some((s) => s.type === "tool" && s.name === "kb_search")).toBe(true);
    } finally {
      await runtime.close();
    }
  });

  it("4) 前端 AgenticChat：应正确展示 LLM 推理与决策、新工具中文名称（如 kb_search -> 检索知识库内容）与子智能体内部步骤", async () => {
    const api = await import("@/api");
    const { AgenticChat } = await import("../web/src/pages/AgenticChat.tsx");

    vi.spyOn(api, "listAgentSessions").mockResolvedValue([
      { id: "s1", title: "测试轨迹显示", thinkingLevel: "medium", scope: undefined } as any,
    ]);
    vi.spyOn(api, "listAvailableModels").mockResolvedValue([]);
    vi.spyOn(api, "listKBs").mockResolvedValue([]);
    vi.spyOn(api, "listHosts").mockResolvedValue([]);
    vi.spyOn(api, "getSettings").mockResolvedValue({ llm_model: "deepseek-chat", default_provider: "default" } as any);
    vi.spyOn(api, "getAgentMessages").mockResolvedValue([
      { id: "msg_1", session_id: "s1", role: "user", content: "查一下配置", created_at: "", sources: [] },
      {
        id: "msg_2",
        session_id: "s1",
        role: "assistant",
        content: "配置正常。",
        status: "completed",
        created_at: "",
        sources: [],
        trace: {
          trace_id: "trace_2",
          workflow_name: "pi-durable-agent",
          metadata: {},
          spans: [
            {
              id: "gen_1",
              type: "generation",
              name: "deepseek-chat",
              agent_id: "orchestrator",
              agent_name: "Orchestrator",
              started_at: "2026-10-27T08:00:00.000Z",
              ended_at: "2026-10-27T08:00:01.000Z",
              duration_ms: 1000,
              usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
              data: { input: [{ role: "user", content: "查一下配置" }], output: { content: "调用 kb_search" } },
            },
            {
              id: "call_kb_1",
              type: "tool",
              name: "kb_search",
              agent_id: "knowledge_agent",
              agent_name: "KnowledgeAgent",
              started_at: "2026-10-27T08:00:01.000Z",
              ended_at: "2026-10-27T08:00:01.200Z",
              duration_ms: 200,
              data: { input: { query: "配置" }, output: "找到配置片段" },
            },
            {
              id: "call_host_1",
              type: "tool",
              name: "host_exec",
              agent_id: "host_agent",
              agent_name: "HostAgent",
              started_at: "2026-10-27T08:00:01.200Z",
              ended_at: "2026-10-27T08:00:01.500Z",
              duration_ms: 300,
              data: { input: { command: "uptime" }, output: "up 1 day" },
            },
          ],
          summary: {
            duration_ms: 1500,
            reasoning: "先查配置再看主机",
            span_count: 3,
            tool_count: 2,
            model_count: 1,
            error_count: 0,
            total_tokens: 150,
            prompt_tokens: 100,
            completion_tokens: 50,
          },
        },
      },
    ]);

    Element.prototype.scrollIntoView = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    try {
      act(() => {
        root.render(
          <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={["/agentic-chat/s1"]}>
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

      // 点击展开「执行轨迹与工具调用 (3 个步骤)」
      const traceBtn = [...container.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("执行轨迹与工具调用"),
      );
      expect(traceBtn).toBeTruthy();
      await act(async () => {
        traceBtn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });

      const html = container.textContent || "";
      expect(html).toContain("LLM 推理与决策 (deepseek-chat)");
      expect(html).toContain("检索知识库内容");
      expect(html).toContain("远程执行受控命令");
      expect(html).toContain("KnowledgeAgent");
      expect(html).toContain("HostAgent");
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.restoreAllMocks();
    }
  });
});
