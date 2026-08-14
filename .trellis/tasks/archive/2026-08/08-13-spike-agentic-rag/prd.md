# Agentic RAG Sidecar PoC

## Goal

Validate whether OpenAI Agents SDK is a suitable Phase 2 runtime for Memoria's agentic RAG direction without replacing the existing classic chat path.

The PoC should introduce a sidecar agentic chat flow where the user does not manually choose a knowledge base. The agent can inspect available knowledge bases, select one or more relevant knowledge bases, search them through Memoria's existing local Chroma/SQLite pipeline, and answer with backend-collected structured sources.

## Requirements

- Preserve the existing classic chat behavior as the stable deterministic RAG path during this PoC.
- Add an agentic chat path that runs independently from the existing `/api/chat/{bot_id}` implementation.
- The agentic path must be able to list allowed knowledge bases and search selected knowledge bases through Memoria's existing data stores.
- The agentic path must not replace Chroma with OpenAI-hosted file search or migrate persisted documents outside Memoria.
- The agentic answer response must include backend-collected `sources` and `used_kbs`; source metadata must not rely on model-generated citation text.
- The PoC must validate OpenAI Agents SDK compatibility with Memoria's effective runtime settings, especially `openai_base_url`, `openai_api_key`, and `llm_model`.
- If non-OpenAI-compatible providers are not supported by the Agents SDK integration, classic chat must continue to support them and agentic chat must fail with an explicit, documented error.
- Keep existing SQLite session/message persistence for the PoC; do not migrate to SDK-managed sessions.
- First implementation may be non-streaming only; streaming tool-step events are a follow-up unless they are cheap and low-risk.
- Existing vault sync, document upload/delete, bot management, settings, and classic chat behavior must not regress.

## Product Contract

- **Classic chat**: deterministic single-context RAG path. It remains the compatibility and fallback path. The final product direction is that classic chat corresponds to one explicit knowledge context; this PoC should not break existing multi-KB Bot data while agentic routing is being validated.
- **Agentic chat**: autonomous knowledge-base selection path. The user asks the agent directly; the agent chooses which allowed KBs to inspect and retrieve from.

## Non-Goals

- Do not introduce multi-agent handoffs in the first PoC.
- Do not add human approval flows in the first PoC.
- Do not replace existing session tables with Agents SDK sessions.
- Do not migrate local Chroma vectors to OpenAI vector stores.
- Do not remove or rewrite the existing `Pipeline.query` / `query_stream` behavior.

## Acceptance Criteria

- [ ] A new sidecar agentic chat backend path exists and can be called without changing existing classic chat endpoints.
- [ ] The agent can call a `list_knowledge_bases` capability that exposes only allowed KB summaries.
- [ ] The agent can call a `search_knowledge_base` capability that validates KB access and reuses Memoria retrieval logic.
- [ ] A normal agentic answer returns `answer`, `session_id`, `used_kbs`, and structured `sources` collected by backend tool execution.
- [ ] If the SDK/provider configuration is unsupported, the endpoint returns a clear 502/503-style error without affecting classic chat.
- [ ] Tests cover KB listing, KB access validation, source collection, and classic chat non-regression.
- [ ] Documentation or notes clearly state which providers were verified for the PoC and which remain classic-chat-only.
- [ ] Focused backend tests and the full Python test suite pass.

## References

- OpenAI Agents SDK overview: https://developers.openai.com/api/docs/guides/agents
- OpenAI Agents SDK quickstart: https://developers.openai.com/api/docs/guides/agents/quickstart
- Agents SDK models/providers: https://developers.openai.com/api/docs/guides/agents/models
- Agents SDK results/state: https://developers.openai.com/api/docs/guides/agents/results
