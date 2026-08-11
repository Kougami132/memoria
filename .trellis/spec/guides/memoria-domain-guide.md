# Memoria Domain Guide

> Project-specific thinking triggers for the memoria RAG knowledge-base system.

---

## Why This Guide

The generic thinking guides cover cross-layer and code-reuse patterns. This guide adds triggers specific to memoria's domain: RAG pipelines, vector stores, vault sync, knowledge bases, bots, chat sessions, and mock mode. When you touch one of these areas, these reminders help you avoid the "didn't think of that" failures that are common in this codebase.

---

## Capability Areas

The system's functional behavior is defined by the following capability areas. Use this mapping when a task names a capability:

- **RAG**: rag-ingest, rag-retrieve, rag-query (chunking, embedding, retrieval, prompt building)
- **Knowledge Bases**: kb-management, document-management (upload and vault types)
- **Vault**: vault-management, vault-sync (local + WebDAV, incremental sync, APScheduler polling)
- **Chat**: chat-session, session-list, session-deletion, chat-message-markdown, chat-sources
- **Bots**: bot-management (KB links, system prompt, model override)
- **Runtime**: runtime-settings, mock-mode (settings override over env defaults)

---

## Thinking Triggers

### When modifying the RAG pipeline

- [ ] Does the change preserve the mock-mode contract? `Pipeline` must work with `MockEmbedder` / `MockLLMCaller` when `settings.use_mock` is True.
- [ ] Do retrieved chunks get filtered by `min_score`? If you change scoring, update the filter threshold logic accordingly.
- [ ] Are scores normalized consistently? `ChromaStore.query` converts distance to `1.0 - dist` (cosine) or `1.0 - dist / 2.0` (L2). A new metric needs its own conversion.
- [ ] Are source metadata fields (`doc_id`, `db_doc_id`) preserved through the pipeline to the API response?
- [ ] Does `query` still truncate history to the last 10 messages before building the prompt?
- [ ] Are debug logs using the `[RAG]` prefix and truncating text to 120/200 chars?

### When modifying vault sync

- [ ] Does the change honor the `cancel_event`? Long-running loops (new/modified file iteration) must check `cancel_event.is_set()` and break.
- [ ] Is the `syncing` flag always reset in a `finally` block, even on exception? A stuck `syncing` flag blocks all future syncs.
- [ ] Are new/modified/deleted files handled? The syncer uses SHA-256 to detect modifications and set difference for added/removed files.
- [ ] Does `_delete_doc` catch exceptions and log a warning, or does it crash the whole sync?
- [ ] Are temp files cleaned up? `_ingest_file` uses `NamedTemporaryFile` and deletes it in `finally`.
- [ ] Is the `_cancel_events` dict cleaned up after sync completes (popped in `finally`)?

### When modifying the vector store

- [ ] Are you extending `VectorStore` (ABC in `storage/base.py`) or bypassing it? New stores must implement `add`, `query`, `delete`.
- [ ] Does `ChromaStore` use per-thread collections via `Pipeline._get_store`? The `threading.local` cache keeps one `ChromaStore` per KB per thread.
- [ ] Are you re-getting the collection on each operation? `_col()` is called per-operation for Chroma 1.x compatibility, not cached on `self`.
- [ ] Does deletion use `where` dict filtering, and does it match the metadata key used at insert time?

### When adding a new API resource

- [ ] Is the router registered in `server/app.py` with prefix `/api`?
- [ ] Is the route module named after the resource and placed in `server/routes/`?
- [ ] Does every handler use `Depends(get_db)` / `Depends(get_pipeline)` for injection?
- [ ] Are `ValueError` exceptions from business logic caught and mapped to 404?
- [ ] Are conflict-state checks (409) done before calling business logic?
- [ ] Does the handler return a plain dict, not a Pydantic response model?

### When modifying the database schema

- [ ] Is the new column added in a `DB.__init__` migration block with a `DEFAULT`?
- [ ] Does `PRAGMA table_info` guard the `ALTER TABLE` so it is idempotent?
- [ ] Is the ORM row class private to `storage/db.py`?
- [ ] Are all `DB` methods that touch the new column returning dicts (marshaling the new field)?
- [ ] Are child rows cleaned up on parent delete? No SQLAlchemy auto-cascade exists.

### When modifying config or runtime settings

- [ ] Is the new setting in `Settings` (pydantic-settings) with an env default?
- [ ] Is it included in `get_effective_settings()` so runtime overrides from the `runtime_settings` table apply?
- [ ] Does `reset_pipeline()` need to be called after settings change for it to take effect (pipeline is a singleton)?
- [ ] Does an empty Bot `system_prompt` fall back to the runtime `system_prompt` default, and does the Bot create form pre-fill that value?
- [ ] Is the `openai_base_url` normalized to end with `/v1` in `get_effective_settings()`?

### When modifying the frontend

- [ ] Is the API function declared in `web/src/api.ts` with a typed return?
- [ ] Is server state managed via TanStack Query, not local useState?
- [ ] Are mutations invalidating the relevant query keys on success?
- [ ] Is the component using shadcn/ui primitives and lucide-react icons?
- [ ] Is the route added to `App.tsx` inside the Layout Routes tree?

---

## Cross-Reference

- Coding conventions: [backend](../backend/index.md), [frontend](../frontend/index.md)
- Generic thinking: [code-reuse](./code-reuse-thinking-guide.md), [cross-layer](./cross-layer-thinking-guide.md)
- Domain checklist: this guide (see Thinking Triggers above)
