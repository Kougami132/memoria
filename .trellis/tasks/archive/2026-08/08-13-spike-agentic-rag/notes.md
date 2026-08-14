## Implementation Notes

Implemented a backend-only Agentic RAG sidecar PoC on top of the existing Bot/session/SQLite/Chroma architecture.

- Added optional `openai-agents` extra in `pyproject.toml`; classic chat still does not depend on it.
- Added `memoria.agents` package:
  - `SourceCollector` deduplicates backend-collected retrieval sources and reports `used_kbs`.
  - `AgentKnowledgeTools` exposes allowlisted `list_knowledge_bases` and `search_knowledge_base` capabilities that reuse `Pipeline.retrieve`.
  - `AgenticRagEngine` owns bot-scoped session/message persistence and has an injectable runner boundary.
  - `OpenAIAgentsRunner` lazily imports the optional OpenAI Agents SDK and uses Memoria effective `openai_base_url`, `openai_api_key`, and `llm_model`.
  - `MockAgentRunner` keeps mock/test mode deterministic without network calls.
- Added bot-scoped endpoint `POST /api/bots/{bot_id}/agent-chat`.
- Registered route through FastAPI app and dependency provider.
- Preserved `/api/chat/{bot_id}` and `/api/chat/{bot_id}/stream` unchanged.

Provider compatibility for this PoC:

- Verified by unit tests in mock mode and through the lazy SDK boundary; no real network/provider call was made in this implementation pass.
- Agentic chat requires the optional OpenAI Agents SDK at runtime unless `USE_MOCK=true` or a test runner is injected.
- OpenAI-compatible base URLs are passed into `AsyncOpenAI(base_url=..., api_key=...)` and `OpenAIChatCompletionsModel`.
- Non-OpenAI-compatible or SDK-incompatible providers should use classic chat until separately verified; the agentic endpoint returns a clear 502-style error if the SDK is absent or unsupported.
