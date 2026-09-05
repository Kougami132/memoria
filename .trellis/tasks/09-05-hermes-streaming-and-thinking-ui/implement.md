# Implementation Plan: Hermes-style Agent Token Streaming & Thinking UI

1. **Backend Event Stream Enhancement**:
   - In `memoria/agents/engine.py`, emit `tool_start` right before `_execute_agent_tool_async` and `tool_end` right after.
   - Emit `sources` event if new sources are collected after KB tool execution.

2. **Frontend Type & Event Dispatching**:
   - In `web/src/api.ts`, add `tool_start` and `tool_end` to `AgentStreamEvent`.
   - Ensure `streamResponses` properly handles tool event types.

3. **Frontend UI State & Rendering**:
   - In `web/src/pages/AgenticChat.tsx`, record tool events into `StreamingAssistantState.activeTools`.
   - Show tool actions inside the thought process box.

4. **Verification**:
   - Run pytest for agentic engine and streaming tests.
   - Verify TypeScript compilation in `web/`.

## Completed Work & Verification

- **Backend Engine (`memoria/agents/engine.py`)**:
  - Added `tool_start` and `tool_end` events around `_execute_agent_tool_async` in `OpenAIAgentsRunner.run_stream`.
  - Added early `sources` dispatch when `collector.list_sources()` returns citations after KB tool execution.
  - Formatted and aligned indentation cleanly to ensure module compilation with zero errors (`python -m py_compile`).

- **Gateway Routes (`memoria/server/routes/openai.py`)**:
  - Added SSE event mapping for `response.tool.start`, `response.tool.end`, and `response.sources` in `/v1/responses`.

- **Frontend API (`web/src/api.ts`)**:
  - Extended `AgentStreamEvent` with `tool_start` and `tool_end`, including `tool_name`, `tool_agent`, `duration_ms`, `error`, and `args`.
  - Updated `streamResponses` generator to parse `response.tool.start` and `response.tool.end`.

- **Frontend UI (`web/src/pages/AgenticChat.tsx`)**:
  - Added `ActiveToolExecution` tracking to `StreamingAssistantState`.
  - Enhanced `StreamingMessageItem` with a collapsible Hermes-style thinking/execution box:
    - Real-time animated state indicator (`思考与执行中...`) and typewriter blinking cursor during streaming.
    - In-flight tool badges with animated spinner (`正在检索知识库...`, `主机命令`, etc.).
    - Completed tool badges with checkmarks and duration tags (`210ms`).
    - Non-regression: Preserved trace cards, approval prompt modals, and token/source citations.

- **Verification**:
  - `python -m py_compile memoria/agents/engine.py memoria/server/routes/openai.py` succeeded with exit code 0.
  - `node web/node_modules/typescript/bin/tsc --project web/tsconfig.json --noEmit` passed with exit code 0.
