# Design: Hermes-style Agent Token Streaming & Thinking UI

## 1. Architecture Overview
1. **Engine Event Protocol (`memoria/agents/engine.py`)**:
   - `run_stream` already emits `thought_delta`, `answer_delta`, and `trace_span`.
   - When entering tool execution, emit:
     - `tool_start`: `{"type": "tool_start", "tool_name": tool_name, "tool_agent": tool_agent_name, "args": args}`
     - `tool_end`: `{"type": "tool_end", "tool_name": tool_name, "tool_agent": tool_agent_name, "duration_ms": duration_ms, "error": tool_error}`
   - When KB search returns sources, emit:
     - `sources`: `{"type": "sources", "sources": collector.list_sources()}`

2. **Web API Layer (`web/src/api.ts`)**:
   - Update `AgentStreamEvent` with `tool_start` and `tool_end`.
   - `streamResponses` parses and yields these events without dropping.

3. **Web UI (`web/src/pages/AgenticChat.tsx`)**:
   - `StreamingAssistantState` tracks `activeTools`: list of active / completed tool executions.
   - Display tool execution badges inside the Thought chain / execution header.
   - Maintain collapsible Thinking UI with real-time text append and auto-scroll.

4. **Tracing & Sources Compatibility**:
   - Trace spans are emitted alongside tool events without changing span schema.
   - `db.update_message_status` and `db.add_message_trace` remain intact.
