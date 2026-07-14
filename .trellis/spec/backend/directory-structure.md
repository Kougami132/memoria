# Directory Structure

> How backend code is organized in this project.

---

## Overview

The backend is a single Python package named `memoria/` placed at the repository root (not under `src/`). It is a layered architecture: FastAPI HTTP layer (`server/`) delegates to business logic (`core/`, `vault/`, `llm/`), which persists through SQLAlchemy models (`storage/db.py`) and a vector store (`storage/chroma_store.py`). Pydantic models live in `models/` and are used for request/response schemas. The compiled React SPA is served from `memoria/static/`.

---

## Directory Layout

```
memoria/
|-- __init__.py
|-- config.py                 # pydantic-settings singleton + get_effective_settings()
|-- cli/
|   `-- main.py               # Click-based CLI entry point (project.scripts: memoria)
|-- core/                     # Business logic
|   |-- chunker.py            # langchain-text-splitters wrapper
|   |-- embedder.py           # OpenAI embedding + MockEmbedder
|   `-- pipeline.py           # RAG orchestration: ingest, retrieve, query
|-- llm/
|   `-- caller.py             # OpenAI chat client + MockLLMCaller
|-- models/                   # Pydantic request/response schemas (bot.py, document.py, knowledge_base.py)
|-- server/
|   |-- app.py                # create_app(), lifespan, static mount, router registration
|   |-- deps.py               # DI singletons: get_db(), get_pipeline(), reset_pipeline()
|   `-- routes/               # One APIRouter module per resource
|       |-- bots.py
|       |-- chat.py
|       |-- documents.py
|       |-- knowledge_bases.py
|       |-- sessions.py
|       |-- settings.py
|       `-- vaults.py
|-- storage/
|   |-- base.py               # VectorStore ABC
|   |-- chroma_store.py       # ChromaStore (VectorStore impl)
|   `-- db.py                 # SQLAlchemy ORM rows + DB class (all data access)
|-- vault/
|   |-- connector.py          # VaultConnector ABC + LocalConnector / WebDAVConnector
|   `-- syncer.py             # VaultSyncer incremental sync
`-- static/                   # Compiled React build output (served by FastAPI)
    |-- index.html
    `-- assets/
```

The frontend source lives separately under `web/` (see `.trellis/spec/frontend/`).

---

## Module Organization

New features follow the existing layering:

1. **HTTP layer** (`server/routes/<resource>.py`): Define an `APIRouter` with a `prefix` matching the resource path. Request/response bodies are Pydantic `BaseModel` classes declared inline in the route module. Handlers use `Depends(get_db)` / `Depends(get_pipeline)` for injection. Routes return plain dicts, not Pydantic response models.

2. **Business logic** (`core/`, `vault/`, `llm/`): Stateful services instantiated once in `server/deps.py`. The `Pipeline` class in `core/pipeline.py` is the central RAG orchestrator. When adding new AI/AI-adjacent logic, extend `Pipeline` rather than calling embedder/LLM directly from routes.

3. **Data access** (`storage/db.py`): All database reads/writes go through the `DB` class. Each method opens a session via the `_s()` contextmanager and returns a plain dict (or `list[dict]`, or `None`). ORM row classes (`KnowledgeBaseRow`, `BotRow`, etc.) are private to `db.py` and never leak to other modules.

4. **Schemas** (`models/`): Pydantic `BaseModel` classes for entities shared across multiple route modules. Simple request bodies used by a single route are declared inline in that route module instead.

---

## Naming Conventions

- **Package**: lowercase, single word `memoria`.
- **Subpackages**: lowercase, plural for collections (`models`, `routes`), singular for functional domains (`core`, `vault`, `storage`).
- **Files**: `snake_case.py`.
- **Classes**: `PascalCase`. ORM rows suffixed `Row` (e.g. `KnowledgeBaseRow`). ABCs plain (`VectorStore`, `VaultConnector`). Implementations prefixed by technology (`ChromaStore`) or mode (`LocalConnector`, `WebDAVConnector`).
- **Mock classes**: prefixed `Mock` (e.g. `MockEmbedder`, `MockLLMCaller`).
- **Route modules**: named after the resource: `bots.py`, `chat.py`, `knowledge_bases.py`, `documents.py`, `sessions.py`, `settings.py`, `vaults.py`.
- **DB methods**: verb-first snake_case (`create_kb`, `get_bot`, `list_vault_files`, `update_vault_auto_sync`).

---

## Examples

- A clean resource module: [knowledge_bases.py](/N:/Data/Projects/memoria/memoria/server/routes/knowledge_bases.py) - router, inline Pydantic body, `Depends(get_db)`, dict return.
- Business logic hub: [pipeline.py](/N:/Data/Projects/memoria/memoria/core/pipeline.py) - orchestrates embedder, vector store, DB, and LLM.
- Data access layer: [db.py](/N:/Data/Projects/memoria/memoria/storage/db.py) - ORM rows, `_s()` session manager, dict-return methods.
- ABC contracts for pluggable backends: [base.py](/N:/Data/Projects/memoria/memoria/storage/base.py) (`VectorStore`), [connector.py](/N:/Data/Projects/memoria/memoria/vault/connector.py) (`VaultConnector`).
