# Implementation Plan

## Phase 0 — Preflight

1. Confirm current task context is `08-13-spike-agentic-rag`.
2. Re-read backend and frontend Trellis specs before editing files.
3. Review official OpenAI Agents SDK pages for current installation, model/provider, tools, and result APIs.
4. Decide whether the first endpoint is global (`/api/agent-chat`) or bot-scoped (`/api/bots/{bot_id}/agent-chat`). Prefer the smallest compatible route after inspecting session ownership constraints.

## Phase 1 — Backend Sidecar Skeleton

1. Add `memoria/agents/` package.
2. Add an optional dependency entry for `openai-agents` unless implementation requires a hard dependency.
3. Add `AgenticRagEngine` with an injectable runner boundary so tests can avoid network calls.
4. Add `SourceCollector` and tests for deduplication / max-source behavior.
5. Add knowledge tool functions:
   - list allowed KB summaries
   - search one allowed KB through existing retrieval logic
6. Add access validation for allowed KB IDs.

## Phase 2 — API Route

1. Add route module for the sidecar agentic chat endpoint.
2. Register the route in `memoria/server/app.py`.
3. Map expected errors to project-standard HTTP responses:
   - `ValueError` / missing resources -> 404 where appropriate
   - invalid KB access -> 409 or 422 depending on final contract
   - SDK/provider connection failures -> 503
   - SDK/API runtime failures -> 502
4. Return plain dicts with `answer`, `session_id`, `used_kbs`, and `sources`.
5. Persist user and assistant messages through the existing DB message table.

## Phase 3 — Frontend Minimal Exposure

Only if needed for the PoC demo:

1. Add typed API interfaces/functions in `web/src/api.ts`.
2. Add a minimal UI entry point that can send an agentic chat request and display answer/sources.
3. Keep classic chat UI unchanged.

If backend validation is enough for the first PoC, defer frontend work.

## Phase 4 — Compatibility Verification

1. Verify OpenAI official configuration path with `OPENAI_API_KEY` and an explicit `LLM_MODEL`.
2. Verify behavior with the existing `OPENAI_BASE_URL` normalization.
3. If DeepSeek/Ollama/Azure-style compatible endpoints fail, document that agentic chat is experimental/OpenAI-Agents-compatible only while classic chat remains provider-compatible.
4. Ensure unsupported SDK configurations produce clear errors and do not crash the server.

## Phase 5 — Tests and Quality

Run focused checks first, then full checks:

```bash
python -m pytest tests/test_agentic_rag.py -q
python -m pytest tests/test_server.py -q
python -m pytest -q
npm --prefix web run lint
npm --prefix web run build
```

If frontend is not changed, still run backend tests and note that frontend checks were not required for the backend-only PoC.

## Review Gates

- Do not replace `/api/chat/{bot_id}`.
- Do not make agentic chat the default engine.
- Do not let model-generated citations become API `sources`.
- Do not directly expose vault credentials or local secrets in tool outputs.
- Do not require network/API keys for unit tests.

## Follow-Up Tasks After PoC

- Enforce or migrate classic chat to a single explicit KB contract.
- Add editable KB descriptions/tags if current metadata is insufficient for agent routing.
- Add agentic streaming with tool-step events.
- Add OpenAI tracing integration and local run diagnostics.
- Add eval/regression fixtures for KB selection accuracy and citation grounding.
- Consider multi-agent handoffs only after single-agent KB routing is stable.
