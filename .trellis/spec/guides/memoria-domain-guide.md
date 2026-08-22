# Memoria Domain Guide

> Project-specific thinking triggers for the memoria RAG & Agent system.

---

## Why This Guide

The generic thinking guides cover cross-layer and code-reuse patterns. This guide adds triggers specific to memoria's domain: RAG pipelines, vector stores, vault sync, connectors (hosts, databases), agent multi-tool orchestration, knowledge bases, bots, chat sessions, and mock mode. When you touch one of these areas, these reminders help you avoid the "didn't think of that" failures that are common in this codebase.

---

## Capability Areas

The system's functional behavior is defined by the following capability areas. Use this mapping when a task names a capability:

- **RAG**: rag-ingest, rag-retrieve, rag-query (chunking, embedding, retrieval, prompt building)
- **Connectors**: connector-framework, host-management, database-connector (pluggable resource abstractions and registries)
- **Agents**: agentic-rag, agent-tools, thought-trace, token-tracking (multi-step ReAct reasoning over KBs and external resources)
- **Knowledge Bases**: kb-management, document-management (upload and vault types)
- **Vault**: vault-management, vault-sync (local + WebDAV, incremental sync, APScheduler polling)
- **Chat**: chat-session, session-list, session-deletion, chat-message-markdown, chat-sources
- **Bots**: bot-management (KB links, Host links, system prompt, model override)
- **Runtime**: runtime-settings, mock-mode (settings override over env defaults)

---

## Thinking Triggers

### When extending or modifying Connectors

- [ ] Does the new connector inherit from BaseConnector in memoria/connectors/base.py?
- [ ] Are resource types registered under ResourceType enum?
- [ ] Does the connector provide 	est_connection() for UI verification and get_tools() for Agent integration?
- [ ] Are permissions and scopes enforced so Bots can only invoke operations on resources explicitly bound to them?
- [ ] Does ConnectorRegistry correctly register instances on demand or startup?

### When modifying Agent Tools & Engine

- [ ] Does AgentTools delegate cleanly across different subsystems (Pipeline for KBs, HostTools for hosts)?
- [ ] Does the tool registration adhere to the standard OpenAI function/tool calling schema with clear parameter docstrings?
- [ ] Are errors during tool execution captured and returned as user-friendly strings to the LLM rather than crashing the loop?

### When modifying the RAG pipeline

- [ ] Does the change preserve the mock-mode contract? Pipeline must work with MockEmbedder / MockLLMCaller when settings.use_mock is True.
- [ ] Do retrieved chunks get filtered by min_score? If you change scoring, update the filter threshold logic accordingly.
- [ ] Are scores normalized consistently? ChromaStore.query converts distance to 1.0 - dist (cosine) or 1.0 - dist / 2.0 (L2). A new metric needs its own conversion.
- [ ] Are source metadata fields (doc_id, db_doc_id) preserved through the pipeline to the API response?
- [ ] Does query still truncate history to the last 10 messages before building the prompt?
- [ ] Are debug logs using the [RAG] prefix and truncating text to 120/200 chars?

### When modifying vault sync

- [ ] Does the change honor the cancel_event? Long-running loops (new/modified file iteration) must check cancel_event.is_set() and break.
- [ ] Is the syncing flag always reset in a inally block, even on exception? A stuck syncing flag blocks all future syncs.
- [ ] Are new/modified/deleted files handled? The syncer uses SHA-256 to detect modifications and set difference for added/removed files.
- [ ] Does _delete_doc catch exceptions and log a warning, or does it crash the whole sync?
- [ ] Are temp files cleaned up? _ingest_file uses NamedTemporaryFile and deletes it in inally?.
- [ ] Is the _cancel_events dict cleaned up after sync completes (popped in inally)?

### When modifying the vector store

- [ ] Are you extending VectorStore (ABC in storage/base.py) or bypassing it? New stores must implement dd, query, delete.
- [ ] Does ChromaStore use per-thread collections via Pipeline._get_store? The 	hreading.local cache keeps one ChromaStore per KB per thread.
- [ ] Are you re-getting the collection on each operation? _col() is called per-operation for Chroma 1.x compatibility, not cached on self.
- [ ] Does deletion use where dict filtering, and does it match the metadata key used at insert time?

### When adding a new API resource

- [ ] Is the router registered in server/app.py with prefix /api?
- [ ] Is the route module named after the resource and placed in server/routes/?
- [ ] Does every handler use Depends(get_db) / Depends(get_pipeline) / Depends(get_registry) for injection?
- [ ] Are ValueError exceptions from business logic caught and mapped to 404?
- [ ] Are conflict-state checks (409) done before calling business logic?
- [ ] Does the handler return a plain dict, not a Pydantic response model?

### When modifying the database schema

- [ ] Is the new column/table added in a DB.__init__ migration block?
- [ ] Does PRAGMA table_info guard the ALTER TABLE so it is idempotent?
- [ ] Is the ORM row class private to storage/db.py?
- [ ] Are all DB methods that touch the new entity returning dicts?
- [ ] Are child rows cleaned up on parent delete (e.g. ot_hosts links)?

### When modifying config or runtime settings

- [ ] Is the new setting in Settings (pydantic-settings) with an env default?
- [ ] Is it included in get_effective_settings() so runtime overrides from the untime_settings table apply?
- [ ] Does eset_pipeline() need to be called after settings change for it to take effect (pipeline is a singleton)?
- [ ] Does an empty Bot system_prompt fall back to the runtime system_prompt default, and does the Bot create form pre-fill that value?
- [ ] Is the openai_base_url normalized to end with /v1 in get_effective_settings()?

---

## Cross-Reference

- Coding conventions: [backend](../backend/index.md), [frontend](../frontend/index.md)
- Generic thinking: [code-reuse](./code-reuse-thinking-guide.md), [cross-layer](./cross-layer-thinking-guide.md)
- Domain checklist: this guide (see Thinking Triggers above)
