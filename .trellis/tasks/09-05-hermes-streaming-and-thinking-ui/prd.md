# PRD: Hermes-style Agent Token Streaming & Thinking UI

## 1. Background
Currently, users experience a stiff/rigid interaction when running the Agentic chat in Memoria: the system appears blocked until the entire multi-turn agent process finishes. In systems like Hermes, the agent outputs token by token, transparently exposes the thinking/reasoning process in real-time, and notifies users when tools are being executed.

## 2. Objectives
1. Deliver real-time, token-by-token streaming response (answer_delta) for Memoria Agent chat.
2. Support model reasoning/thinking streams (thought_delta) and render them in a collapsible Thinking container in the Web UI.
3. Provide real-time tool execution notifications (tool_start, tool_end) so users observe actions in flight.
4. Maintain 100% compatibility with existing Tracing (trace_span, span timing, token counts) and Citations/Sources.

## 3. Scope & Requirements
- Backend: Extend `AgenticRagEngine.run_stream` in `memoria/agents/engine.py` to emit `tool_start`, `tool_end`, and early `sources` events.
- Frontend API: Ensure `web/src/api.ts` typed events and streaming reader handle `tool_start` and `tool_end`.
- Frontend UI: Update `web/src/pages/AgenticChat.tsx` to display real-time tool progress indicators inside the collapsible thought / execution container.
- Non-regression: Existing trace collection and database persistence must continue to record full spans and accurate token usage.
