# Directory Structure

> How backend code is organized in this project.

---

## Overview

The backend is a single Python package named memoria/ placed at the repository root (not under src/). It is a layered architecture: FastAPI HTTP layer (server/) delegates to business logic (core/, gents/, connectors/, ault/, llm/), which persists through SQLAlchemy models (storage/db.py) and a vector store (storage/chroma_store.py). Pydantic models live in models/ and are used for request/response schemas. The compiled React SPA is served from memoria/static/.

---

## Directory Layout

`
memoria/
|-- __init__.py
|-- config.py                 # pydantic-settings singleton + get_effective_settings()
|-- agents/                   # ReAct Agent orchestrator & multi-tool engine
|   |-- engine.py             # Agent runtime loop & execution engine
|   -- tools.py              # Unified AgentTools container (RAG + Host tools)
|-- cli/
|   -- main.py               # Click-based CLI entry point (project.scripts: memoria)
|-- connectors/               # Generic multi-resource connector framework
|   |-- base.py               # BaseConnector ABC & ResourceType definitions
|   |-- registry.py           # ConnectorRegistry singleton & multi-instance routing
|   -- host/                 # HostConnector (SSH / Local host management & command execution)
|-- core/                     # Business logic
|   |-- chunker.py            # langchain-text-splitters wrapper
|   |-- embedder.py           # OpenAI embedding + MockEmbedder
|   -- pipeline.py           # RAG orchestration: ingest, retrieve, query
|-- llm/
|   -- caller.py             # OpenAI chat client + MockLLMCaller
|-- models/                   # Pydantic request/response schemas (bot.py, document.py, knowledge_base.py)
|-- server/
|   |-- app.py                # create_app(), lifespan, static mount, router registration
|   |-- deps.py               # DI singletons: get_db(), get_pipeline(), get_registry(), reset_pipeline()
|   -- routes/               # One APIRouter module per resource
|       |-- bots.py
|       |-- chat.py
|       |-- documents.py
|       |-- hosts.py          # Host management & test-connection endpoints
|       |-- knowledge_bases.py
|       |-- sessions.py
|       |-- settings.py
|       -- vaults.py
|-- storage/
|   |-- base.py               # VectorStore ABC
|   |-- chroma_store.py       # ChromaStore (VectorStore impl)
|   -- db.py                 # SQLAlchemy ORM rows + DB class (all data access)
|-- vault/
|   |-- connector.py          # VaultConnector ABC + LocalConnector / WebDAVConnector
|   -- syncer.py             # VaultSyncer incremental sync
-- static/                   # Compiled React build output (served by FastAPI)
    |-- index.html
    -- assets/
`

The frontend source lives separately under web/ (see .trellis/spec/frontend/).

---

## Module Organization

New features follow the existing layering:

1. **HTTP layer** (server/routes/<resource>.py): Define an APIRouter with a prefix matching the resource path. Request/response bodies are Pydantic BaseModel classes declared inline in the route module. Handlers use Depends(get_db) / Depends(get_pipeline) / Depends(get_registry) for injection. Routes return plain dicts, not Pydantic response models.

2. **Connectors and External Resources** (connectors/): Pluggable multi-resource integrations (ResourceType.HOST, DATABASE, etc.) implementing BaseConnector. Managed via ConnectorRegistry. Expose scoped tools to AgentTools for agent-driven execution.

3. **Business logic & Agent Engine** (core/, gents/, ault/, llm/): Stateful services instantiated once in server/deps.py. Pipeline handles RAG orchestration, and AgentEngine / AgentTools orchestrate multi-turn ReAct reasoning over bound knowledge bases and connectors.

4. **Data access** (storage/db.py): All database reads/writes go through the DB class. Each method opens a session via the _s() contextmanager and returns a plain dict (or list[dict], or None). ORM row classes (KnowledgeBaseRow, BotRow, HostRow, etc.) are private to db.py and never leak to other modules.

5. **Schemas** (models/): Pydantic BaseModel classes for entities shared across multiple route modules. Simple request bodies used by a single route are declared inline in that route module instead.

---

## Naming Conventions

- **Package**: lowercase, single word memoria.
- **Subpackages**: lowercase, plural for collections (models, outes, connectors), singular for functional domains (core, ault, storage, gents).
- **Files**: snake_case.py.
- **Classes**: PascalCase. ORM rows suffixed Row (e.g. KnowledgeBaseRow, HostRow). ABCs plain (VectorStore, BaseConnector, VaultConnector). Implementations prefixed by technology (ChromaStore, HostConnector).
- **Mock classes**: prefixed Mock (e.g. MockEmbedder, MockLLMCaller).
- **Route modules**: named after the resource: ots.py, chat.py, hosts.py, knowledge_bases.py, documents.py, sessions.py, settings.py, aults.py.
- **DB methods**: verb-first snake_case (create_kb, get_bot, list_hosts, create_host).

---

## Examples

- A clean resource module: [hosts.py](/N:/Data/Projects/memoria/memoria/server/routes/hosts.py) - router, inline Pydantic body, Depends(get_db), Depends(get_registry).
- Connector abstraction: [base.py](/N:/Data/Projects/memoria/memoria/connectors/base.py) (BaseConnector, ResourceType).
- Agent multi-tool engine: [tools.py](/N:/Data/Projects/memoria/memoria/agents/tools.py) - unified interface across RAG retrieval and host execution.
