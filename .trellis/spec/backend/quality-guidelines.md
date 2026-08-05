# Quality Guidelines

> Code quality standards for backend development.

---

## Overview

The project targets Python 3.11+ and uses standard tooling: `black` for formatting, `ruff` for linting, and `pytest` with `pytest-asyncio` for testing. Type hints are expected on all public functions. The mock-mode architecture (`MockEmbedder`, `MockLLMCaller`, `settings.use_mock`) allows full testing of the RAG pipeline without external API dependencies.

---

## Required Patterns

1. **`from __future__ import annotations`** at the top of modules that use `X | None` union syntax in type hints. This is used in `pipeline.py`, `syncer.py`, `connector.py`, `vaults.py`. Modules that only use `typing.Optional` (like `chat.py`) omit it.

2. **Type hints on all public functions and methods.** Use Python 3.10+ union syntax (`str | None`, `list[dict]`) in modules with `from __future__ import annotations`, or `Optional[str]` / `List[dict]` from `typing` in modules without it. Match the style already used in each file.

3. **Dict-return pattern from DB methods.** Every `DB` method returns a plain dict (or `list[dict]`, or `None`). Never return ORM row objects.

4. **Pydantic `BaseModel` for request bodies.** Every POST/PUT/PATCH endpoint defines a Pydantic model for its request body, even if it has a single field. Define inline in the route module for simple cases, in `models/` for shared schemas.

5. **FastAPI `Depends()` for injection.** Routes receive `db` and `pipeline` via `Depends(get_db)` / `Depends(get_pipeline)`, never by importing and calling the singleton directly.

6. **Logging via `logger = logging.getLogger(__name__)`** at module level. Use `%`-style args, not f-strings.

7. **Context manager `_s()` for DB sessions.** Never open a raw session; always use `with self._s() as s:`.

---

## Forbidden Patterns

1. **Returning ORM row objects from `DB` methods.** The session closes inside `_s()`, so detached-instance errors will occur. Always marshal to a dict.

2. **Calling `embedder` or `llm` directly from route handlers.** All AI calls must go through `Pipeline` methods (`query`, `ingest`, `retrieve`, `delete_doc`). This keeps the mock-mode architecture intact.

3. **Importing ORM row classes outside `storage/db.py`.** Row classes (`KnowledgeBaseRow`, `BotRow`, etc.) are private to `db.py`. Other modules interact with the `DB` class via dict returns only.

4. **Using `Session()` directly without `_s()`.** Raw session creation bypasses the commit/rollback/close safety net.

5. **Hardcoding config values.** All tunable values (model names, chunk size, top_k, paths) must come from `Settings` or the `runtime_settings` table via `get_effective_settings()`.

6. **Using `datetime.now()` without timezone.** Always use `datetime.now(timezone.utc).isoformat()` (via the `_now()` helper in `db.py`).

7. **Leaking the `webdav_password` in API responses.** The vault route uses `_mask_vault()` to strip the password before returning. Any new vault-related endpoint must follow this pattern.

---

## Testing Requirements

### Framework

- `pytest` (test path: `tests/`, configured in `pyproject.toml` via `[tool.pytest.ini_options]`)
- `pytest-asyncio` for async route handlers

### Mock mode testing

The project's `settings.use_mock = True` flag swaps real API clients for `MockEmbedder` and `MockLLMCaller`. Tests should:

1. Set `settings.use_mock = True` (or use environment variable `USE_MOCK=true`).
2. Call `reset_pipeline()` to force re-initialization with mock clients.
3. Use a temporary `db_path` and `chroma_path` (e.g. via `tmp_path` fixture).

```python
def test_query_with_mock(tmp_path):
    from memoria.config import settings
    from memoria.server.deps import reset_pipeline
    settings.use_mock = True
    settings.db_path = str(tmp_path / "test.db")
    settings.chroma_path = str(tmp_path / "chroma")
    reset_pipeline()
    # ... test pipeline.query(...)
```

### Test coverage expectations

- **DB methods**: test create/get/list/update/delete for each entity. Use a temp database.
- **Pipeline**: test `ingest`, `retrieve`, `query` with mock mode. Verify chunk filtering, min_score, and session persistence.
- **Routes**: use FastAPI's `TestClient` with mock mode enabled. Test happy path and error cases (404 for missing entities, 409 for conflicts).
- **Vault sync**: test `LocalConnector` with a temp directory. Verify incremental sync (new/modified/deleted files).

---

## Code Review Checklist

- [ ] All `DB` methods return dicts, not ORM objects
- [ ] New route handlers catch `ValueError` and map to appropriate HTTP status
- [ ] `webdav_password` is never in API responses
- [ ] Type hints present on public functions
- [ ] `from __future__ import annotations` if the module uses `X | None` syntax
- [ ] Logging uses `%`-style args, not f-strings
- [ ] Logger uses `__name__`, not a custom string
- [ ] No hardcoded config values (use `settings` or `get_effective_settings`)
- [ ] Background threads reset state in `finally` blocks
- [ ] New DB columns have a migration block in `DB.__init__` with a `DEFAULT` value
- [ ] New tables have an ORM row class and are covered by `create_all`

### Vault Document Deletion Contract

Vault synchronization and manual document deletion span SQLite and Chroma. The
SQLite document primary key is stored in Chroma metadata as `db_doc_id`; the
metadata field `doc_id` is only the synthesized business/display identifier.
`Pipeline.delete_doc(doc_id, kb_id)` must delete vectors with
`where={"db_doc_id": doc_id}` before deleting the SQLite row. Vault sync must
delete the old document before ingesting a changed file, and must retain the
`vault_files` tracking row when deletion or replacement fails so a later sync
can retry cleanup. Failures must be logged with a traceback rather than
silently ignored.

Required assertions:

- A changed vault file leaves exactly one SQLite document and removes the old
  document.
- A deleted vault file removes both its SQLite document and tracking row.
- Pipeline deletion calls the vector store with the `db_doc_id` metadata key.

### One-off Vault Repair Contract

The historical cleanup command is `memoria repair-vault-docs`. It defaults to
dry-run and requires `--apply` to mutate data; `--kb-id` may restrict the
operation to one Vault knowledge base. Apply mode runs normal Vault sync first,
then deletes only `source="vault"` documents that are not referenced by any
selected `vault_files.doc_id`. Upload documents are never selected by filename.
