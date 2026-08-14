# Technical Design

## Current State

Memoria currently uses a classic deterministic RAG loop in `memoria.core.pipeline.Pipeline`:

1. Load Bot configuration and associated KB IDs from SQLite.
2. Retrieve top chunks from every associated KB via Chroma.
3. Filter and merge chunks by score.
4. Inject the selected chunk text into the system prompt.
5. Call `LLMCaller`, which uses the OpenAI Python client Chat Completions API.
6. Persist user and assistant messages in SQLite.

This path is simple, testable, and supports OpenAI-compatible providers through `OPENAI_BASE_URL` normalization. It should remain the stable fallback.

## Target PoC Shape

Add a sidecar `AgenticRagEngine` that uses OpenAI Agents SDK for the agent runtime while keeping Memoria's existing storage and retrieval stack.

```
FastAPI
  ├─ Classic chat route
  │    └─ Pipeline.query / query_stream
  │         ├─ DB
  │         ├─ ChromaStore
  │         └─ LLMCaller
  │
  └─ Agentic chat route
       └─ AgenticRagEngine
            ├─ OpenAI Agents SDK Agent / Runner
            ├─ AgentKnowledgeTools
            │    ├─ list_knowledge_bases
            │    └─ search_knowledge_base
            ├─ SourceCollector
            ├─ DB sessions/messages
            └─ Pipeline.retrieve / source-building helpers
```

The sidecar route should be additive. It must not change the default behavior of `/api/chat/{bot_id}`.

## Proposed Modules

- `memoria/agents/__init__.py`
- `memoria/agents/engine.py`
  - `AgenticRagEngine`
  - runtime setup, agent construction, query orchestration, persistence
- `memoria/agents/tools.py`
  - knowledge-base listing and search tool wrappers
  - KB allow-list checks
- `memoria/agents/state.py`
  - `SourceCollector` / run-local context objects
- `memoria/server/routes/agent_chat.py`
  - sidecar HTTP route
- `memoria/server/deps.py`
  - `get_agentic_engine()` singleton, if the implementation needs a long-lived service

Keep naming under `memoria/agents` to avoid overloading `memoria/core/pipeline.py` with two different orchestration loops.

## API Contract

Initial non-streaming endpoint, exact route to confirm during implementation:

```http
POST /api/agent-chat
```

Request:

```json
{
  "message": "What did I decide about vault sync?",
  "session_id": "optional existing session id",
  "allowed_kb_ids": ["optional", "kb", "allowlist"]
}
```

Response:

```json
{
  "answer": "...",
  "session_id": "...",
  "used_kbs": [
    {"id": "kb_1", "name": "Project notes"}
  ],
  "sources": [
    {
      "text": "...",
      "score": 0.82,
      "doc_id": "vector-doc-id-or-db-doc-id",
      "db_doc_id": "...",
      "kb_id": "kb_1",
      "filename": "design.md",
      "path": "notes/design.md",
      "source": "vault"
    }
  ]
}
```

A bot-scoped endpoint can be considered instead:

```http
POST /api/bots/{bot_id}/agent-chat
```

This is useful if agent access should inherit a Bot's KB links and system prompt. The PoC should choose the route that creates the least migration risk.

## Tool Contracts

### `list_knowledge_bases`

Input: none.

Output: list of allowed KB summaries:

```json
[
  {
    "id": "...",
    "name": "...",
    "description": "...",
    "type": "upload|vault",
    "document_count": 12,
    "created_at": "..."
  }
]
```

Rules:

- Only return KBs in the request allow-list or bot allow-list.
- Include descriptions because the agent needs semantic hints for KB selection.
- Do not include secrets or vault credentials.

### `search_knowledge_base`

Input:

```json
{
  "kb_id": "...",
  "query": "...",
  "top_k": 5
}
```

Output: compact search result for the model, plus backend collector side effects:

```json
{
  "kb_id": "...",
  "results": [
    {
      "source_index": 1,
      "filename": "...",
      "path": "...",
      "score": 0.82,
      "text": "short chunk text"
    }
  ]
}
```

Rules:

- Reject inaccessible `kb_id` before retrieval.
- Clamp `top_k` to a safe configured maximum.
- Reuse `Pipeline.retrieve` so scoring and Chroma access stay consistent.
- Add the full structured source records to `SourceCollector` at tool execution time.
- Return compact text to the model to reduce token usage.

## Source Collection

The final `sources` array must be constructed from backend retrieval results, not model prose. This avoids hallucinated citations.

`SourceCollector` should track:

- unique source identity, preferably `(kb_id, db_doc_id, text)` or vector ID where available
- score
- source text
- KB ID/name
- document metadata from SQLite

If the same source appears in multiple tool calls, deduplicate while preserving the best score.

## Session Strategy

For the PoC, keep SQLite sessions/messages as the source of truth.

- If `session_id` is absent, create a session with a distinct bot or agent owner strategy chosen during implementation.
- If `session_id` is provided, validate it exists before running the agent.
- Persist the user message and final assistant answer after a completed run.
- Persist backend-collected sources with the assistant message, matching classic chat behavior.

Do not use SDK-managed sessions in the first PoC. SDK result history may be used internally only if needed to continue the run within the same request.

## Provider Compatibility

OpenAI documentation describes the Agents SDK as the shortest path for SDK-based agents and emphasizes explicit model selection. It also distinguishes the default OpenAI provider path from provider/adapter configuration for non-OpenAI or mixed-provider stacks.

Memoria currently advertises OpenAI-compatible providers through `OPENAI_BASE_URL`. Therefore the PoC must keep compatibility boundaries explicit:

- Classic chat remains OpenAI-compatible-first.
- Agentic chat initially targets OpenAI Agents SDK-compatible configurations.
- Unsupported provider/configuration errors must be clear and non-destructive.
- Runtime settings used by the agentic path must come from `get_effective_settings(db)` rather than raw environment values when possible.

## Dependency Strategy

Prefer adding `openai-agents` as an optional dependency first:

```toml
[project.optional-dependencies]
agents = ["openai-agents>=..."]
```

If product direction requires always-on agentic chat, the dependency can later move into the main dependency list after provider compatibility is proven.

## Limits and Safety

Set conservative limits in the first implementation:

- maximum tool calls / iterations
- maximum `search_knowledge_base` calls per run
- maximum `top_k` per search
- maximum total sources returned
- timeout around agent execution if practical

The agent instructions must require:

- list KBs before searching unless the request provides an explicit KB ID
- search only allowed KBs
- answer from retrieved sources when the question asks about the user's knowledge base
- state when available sources are insufficient
- never invent citations

## Streaming Follow-Up

Initial PoC may be non-streaming. A later task can add NDJSON streaming events:

```json
{"type":"agent_step","message":"Choosing knowledge base..."}
{"type":"tool_call","tool":"list_knowledge_bases"}
{"type":"tool_call","tool":"search_knowledge_base","kb_id":"..."}
{"type":"delta","delta":"..."}
{"type":"final","answer":"...","sources":[...]}
```

The event shape should be compatible with the current frontend stream parser style but should not block the first PoC.

## Testing Strategy

- Unit-test tool access filtering and result shaping with a real `DB` and mocked pipeline retrieval.
- Unit-test `SourceCollector` deduplication.
- Route-test agentic endpoint using a fake agent runner or injected engine so tests do not require network access.
- Regression-test classic `/api/chat/{bot_id}` still works.
- Keep mock mode usable.

## Rollback Strategy

The feature is additive. Rollback is removal or disabling of the sidecar route and optional dependency. Existing classic chat, documents, vault sync, and settings should remain unchanged.
