# Memoria Channel Compatibility Research

## Verified Existing Boundaries

Memoria is a Python/FastAPI application. Its lifespan starts APScheduler and vault synchronization, but no QQ adapter or channel lifecycle exists.

REST chat routes call `AgenticRagEngine.run()` or `run_stream()`. When `bot_id` is omitted, the engine uses the system-level Agent path: global knowledge bases, global hosts, global system prompt, and `create_agentic_session()`. It persists messages/traces and emits `init`, `answer_delta`, `done`, and `approval_required` events. This is the path QQ should use.

The database has `sessions`, `messages`, and `message_traces`. Agentic sessions use internal UUIDs and have no platform, external context, QQ app, OpenID, or external-session uniqueness fields. The Bot model is not involved in the proposed QQ path. Schema additions require the project's idempotent migration pattern.

## Directly Reusable

- Agentic RAG engine and existing system-level settings;
- message, trace, and session persistence after adding external mapping;
- FastAPI lifespan as adapter startup/shutdown owner;
- Host Guard and existing approval manager as lower-level security components;
- existing async WebSocket dependency, subject to protocol/client requirements.

## Required New Boundary

Add a QQ adapter that consumes official Gateway events, applies QQ policy, resolves a durable external-context mapping to an agentic session, invokes `AgenticRagEngine` with `bot_id=None`, and sends typed responses through official QQ REST APIs. QQ protocol details must stay out of the Agent engine and REST routes.

## Session Consequence

QQ OpenIDs and guild/channel IDs cannot be passed directly to the current engine, which expects an internal UUID. A durable mapping keyed by QQ app, context type, external context ID, and fixed system-Agent scope is mandatory to prevent history loss and cross-context leakage. No Bot mapping is needed.
