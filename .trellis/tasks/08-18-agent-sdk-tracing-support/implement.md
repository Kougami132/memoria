# Implementation Plan: Agent SDK Tracing in Memoria Web

## Backend

- [x] Add trace result dataclasses/types in `memoria/agents/engine.py`.
- [x] Extend `AgentRunner.run()` signature to accept optional `session_id` and return text plus optional trace data.
- [x] Implement a request-local tracing collector for OpenAI Agents SDK.
- [x] Replace global `set_tracing_disabled(True)` with per-run `RunConfig` tracing control.
- [x] Update `AgenticRagEngine.run()` to persist assistant message id and trace data.
- [x] Add `MessageTraceRow` and DB methods in `memoria/storage/db.py`.
- [x] Include trace data in `get_messages_all()` message dicts.
- [x] Add tests for SDK trace collection, DB trace persistence, API response, and historical message loading.

## Frontend

- [x] Extend `web/src/api.ts` types with `AgentTrace`, `AgentTraceSpan`, and response/message trace fields.
- [x] Add `TracePanel` to `web/src/pages/AgenticChat.tsx` below sources.
- [x] Render trace summary collapsed and chronological span list expanded.
- [x] Keep trace optional for old messages and mock/no-trace cases.

## Validation

- [x] Run backend tests related to agentic RAG.
- [x] Run frontend TypeScript/build validation.
- [x] Run full tests if targeted tests pass.
