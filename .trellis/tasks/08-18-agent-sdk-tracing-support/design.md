# Design: Agent SDK Tracing in Memoria Web

## Objective

Capture OpenAI Agents SDK traces locally and expose them in the Memoria Agentic RAG web UI per assistant response.

## Current State

- `OpenAIAgentsRunner.run()` calls `set_tracing_disabled(True)`, so SDK tracing is globally disabled.
- Agentic responses return `answer`, `session_id`, `used_kbs`, and `sources` only.
- `messages` stores `sources` JSON, but there is no trace/span persistence.
- The Agentic web page renders message content, used KBs, and source list.

## Data Model

Add a new `message_traces` table keyed by assistant `message_id`:

- `id`: UUID primary key for the stored trace record.
- `session_id`: agentic session id.
- `message_id`: assistant message id.
- `trace_id`: SDK trace id.
- `workflow_name`: SDK workflow name.
- `group_id`: SDK group id, set to the session id.
- `metadata`: JSON string.
- `spans`: JSON string containing exported spans.
- `created_at`: UTC ISO timestamp.

The DB returns plain dicts only. New table creation is handled by SQLAlchemy `create_all`; no column migration is needed unless evolving existing tables.

## Backend Flow

1. `AgenticRagEngine.run()` creates/loads the session before calling the runner.
2. The engine passes `session_id` into the runner.
3. `OpenAIAgentsRunner` creates a request-scoped trace collector processor and calls `Runner.run(..., run_config=RunConfig(...))`.
4. The runner returns both final text and exported trace data.
5. The engine stores the assistant message and captures its generated `message_id`.
6. The engine stores the trace linked to that assistant message.
7. Agent chat response includes `trace` summary/details so the current message can render immediately.
8. Loading historical agent messages returns the stored trace with each assistant message.

## Tracing Export Shape

Expose a UI-friendly object:

```json
{
  "id": "...",
  "trace_id": "trace_...",
  "workflow_name": "Memoria agentic chat",
  "group_id": "session-id",
  "metadata": {"session_id": "...", "model": "..."},
  "spans": [
    {"id": "span_...", "parent_id": null, "type": "agent", "name": "Memoria Agentic RAG", "duration_ms": 1234, "data": {...}, "error": null}
  ],
  "summary": {"duration_ms": 1234, "span_count": 4, "tool_count": 2, "model_count": 1, "error_count": 0}
}
```

## Privacy

Use `trace_include_sensitive_data=False` by default to avoid storing full prompts, model outputs, and tool payloads. The local processor still stores span structure, status, durations, span names, and non-sensitive metadata.

## Web UI

Add `TracePanel` inside `AgenticChat.tsx`, displayed below existing used-KB/source panels on assistant messages.

Default collapsed summary:

- total duration
- span count
- tool count
- model call count
- error count if any

Expanded view:

- chronological list of spans
- icon/badge by span type: agent, function/tool, generation/model, handoff, custom
- duration and status per span
- collapsible JSON details for each span, sanitized by backend privacy choice

## Compatibility

- Mock runner returns no trace or a small mock trace only if needed for tests.
- Existing chat and non-agentic routes are unaffected.
- Existing messages without traces return `trace: null`.
