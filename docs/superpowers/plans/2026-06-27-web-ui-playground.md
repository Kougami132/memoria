---
change: web-ui-playground
design-doc: docs/superpowers/specs/2026-06-27-web-ui-playground-design.md
base-ref: 3be0745b8574412e9543643878b98405a804c239
---

# Web UI Playground Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Build a Web UI for Memoria Phase 1 REST API so users can experience RAG capabilities without curl/Swagger.

**Architecture:** Extend backend DB layer, config override layer and new routes; build React+Vite SPA into `memoria/static/`; FastAPI mounts the static dir -- single process serves both API and UI.

**Tech Stack:** Python/FastAPI/SQLAlchemy (backend); React 18 + TypeScript + Vite + shadcn/ui + Tailwind CSS v3 + TanStack Query v5 + react-router-dom v6 (frontend)

## Global Constraints

- Python test framework: pytest, using `TestClient` + `dependency_overrides`
- All new routes prefixed with `/api`, route files in `memoria/server/routes/`
- Frontend build output dir: `memoria/static/` (relative path `../../memoria/static` from inside `web/`)
- shadcn/ui based on Tailwind CSS v3 (not v4)
- `get_db` keeps `@lru_cache` unchanged; only `get_pipeline` becomes resettable
- `GET /api/settings` returns plaintext api_key (local single-user service, deliberate design decision)
- When `memoria/static/` is missing, log warning only -- API still works normally
- All new backend functionality must have corresponding pytest test coverage

---

## File Structure

**Files to create or modify:**
- `memoria/storage/db.py` -- append `RuntimeSettingRow` ORM model + 4 new methods
- `memoria/config.py` -- append `get_effective_settings(db)` function
- `memoria/server/deps.py` -- refactor `get_pipeline` to module-level var + `reset_pipeline()`
- `memoria/server/routes/settings.py` -- NEW, `GET/PUT /api/settings`
- `memoria/server/routes/sessions.py` -- NEW, `GET /api/sessions/{session_id}/messages`
- `memoria/server/routes/bots.py` -- append `GET /api/bots/{bot_id}/sessions`
- `memoria/server/app.py` -- register new routes, mount static dir
- `memoria/core/pipeline.py` -- `query()` appends `sources` field
- `tests/test_storage.py` -- append RuntimeSetting and list_sessions/get_messages_all tests
- `tests/test_server.py` -- append settings, sessions, sources tests
- `tests/test_config_override.py` -- NEW, config override unit tests
- `web/` -- React+Vite frontend project (brand new)

---

### Task 1: DB Layer Extension

**Files:**
- Modify: `memoria/storage/db.py`
- Modify: `tests/test_storage.py`

**Interfaces:**
- Produces:
  - `db.get_setting(key: str) -> str | None`
  - `db.set_setting(key: str, value: str) -> None`
  - `db.get_all_settings() -> dict[str, str]`
  - `db.list_sessions(bot_id: str) -> list[dict]` -- each entry: `{id, bot_id, created_at}`, ordered by `created_at` DESC
  - `db.get_messages_all(session_id: str) -> list[dict]` -- all messages, ordered by `created_at` ASC

- [x] **Step 1: Write failing tests**

Append to `tests/test_storage.py`:

```python
def test_runtime_settings(db):
    assert db.get_setting("top_k") is None
    db.set_setting("top_k", "10")
    assert db.get_setting("top_k") == "10"
    db.set_setting("top_k", "20")
    assert db.get_setting("top_k") == "20"
    assert db.get_all_settings() == {"top_k": "20"}


def test_list_sessions(db):
    bot = db.create_bot("b", "", [])
    s1 = db.create_session(bot["id"])
    s2 = db.create_session(bot["id"])
    sessions = db.list_sessions(bot["id"])
    assert len(sessions) == 2
    assert sessions[0]["id"] == s2["id"]  # DESC: s2 first
    assert sessions[1]["id"] == s1["id"]


def test_get_messages_all(db):
    bot = db.create_bot("b", "", [])
    sess = db.create_session(bot["id"])
    for i in range(15):
        db.add_message(sess["id"], "user", f"msg{i}")
    msgs = db.get_messages_all(sess["id"])
    assert len(msgs) == 15
    assert msgs[0]["content"] == "msg0"
    assert msgs[14]["content"] == "msg14"


def test_get_messages_all_session_not_exist(db):
    msgs = db.get_messages_all("nonexistent-id")
    assert msgs == []
```

- [x] **Step 2: Run tests, confirm failure**

```bash
cd N:/Data/Projects/memoria
python -m pytest tests/test_storage.py::test_runtime_settings -v
```

Expected: FAILED (AttributeError: 'DB' object has no attribute 'get_setting')

- [x] **Step 3: Modify `memoria/storage/db.py`**

Insert `RuntimeSettingRow` ORM model after `MessageRow` class definition, before `_now()` function:

```python
class RuntimeSettingRow(Base):
    __tablename__ = "runtime_settings"
    key = Column(String, primary_key=True)
    value = Column(String, nullable=False)
    updated_at = Column(String, nullable=False)
```

Append 5 new methods after `DB.add_message`:

```python
    # -- Runtime Settings ---------------------------------------------------

    def get_setting(self, key: str) -> str | None:
        with self._s() as s:
            row = s.get(RuntimeSettingRow, key)
            return row.value if row else None

    def set_setting(self, key: str, value: str) -> None:
        with self._s() as s:
            row = s.get(RuntimeSettingRow, key)
            if row:
                row.value = value
                row.updated_at = _now()
            else:
                s.add(RuntimeSettingRow(key=key, value=value, updated_at=_now()))

    def get_all_settings(self) -> dict[str, str]:
        with self._s() as s:
            return {r.key: r.value for r in s.query(RuntimeSettingRow).all()}

    def list_sessions(self, bot_id: str) -> list[dict]:
        with self._s() as s:
            rows = (s.query(SessionRow)
                    .filter(SessionRow.bot_id == bot_id)
                    .order_by(desc(SessionRow.created_at))
                    .all())
            return [{"id": r.id, "bot_id": r.bot_id, "created_at": r.created_at} for r in rows]

    def get_messages_all(self, session_id: str) -> list[dict]:
        with self._s() as s:
            rows = (s.query(MessageRow)
                    .filter(MessageRow.session_id == session_id)
                    .order_by(MessageRow.created_at)
                    .all())
            return [{"id": r.id, "session_id": r.session_id, "role": r.role,
                     "content": r.content, "created_at": r.created_at}
                    for r in rows]
```

- [x] **Step 4: Run all storage tests**

```bash
cd N:/Data/Projects/memoria
python -m pytest tests/test_storage.py -v
```

Expected: all PASSED

- [x] **Step 5: Commit**

```bash
cd N:/Data/Projects/memoria
git add memoria/storage/db.py tests/test_storage.py
git commit -m "feat: extend DB with runtime_settings table and list_sessions/get_messages_all"
```

---

### Task 2: Config Override Layer + Resettable Pipeline

**Files:**
- Modify: `memoria/config.py`
- Modify: `memoria/server/deps.py`
- Create: `tests/test_config_override.py`

**Interfaces:**
- Consumes: `db.get_all_settings() -> dict[str, str]` (from Task 1)
- Produces:
  - `get_effective_settings(db: DB) -> dict` -- returns dict with 7 keys, all str values: `{openai_base_url, openai_api_key, embedding_model, llm_model, top_k, chunk_size, chunk_overlap}`
  - `get_pipeline() -> Pipeline` -- module-level cache, builds on first call
  - `reset_pipeline() -> None` -- sets cache to None, next `get_pipeline()` call rebuilds

- [x] **Step 1: Write failing tests**

Create `tests/test_config_override.py`:

```python
import pytest
from memoria.storage.db import DB
from memoria.config import get_effective_settings


@pytest.fixture
def db(tmp_path):
    return DB(str(tmp_path / "test.db"))


def test_get_effective_settings_defaults(db):
    result = get_effective_settings(db)
    assert set(result.keys()) == {
        "openai_base_url", "openai_api_key", "embedding_model",
        "llm_model", "top_k", "chunk_size", "chunk_overlap"
    }
    assert result["top_k"] == "5"
    assert result["chunk_size"] == "512"


def test_get_effective_settings_override(db):
    db.set_setting("top_k", "10")
    db.set_setting("llm_model", "gpt-4o")
    result = get_effective_settings(db)
    assert result["top_k"] == "10"
    assert result["llm_model"] == "gpt-4o"
    assert result["chunk_size"] == "512"  # unchanged default
```

```bash
cd N:/Data/Projects/memoria
python -m pytest tests/test_config_override.py -v
```

Expected: FAILED (ImportError: cannot import name 'get_effective_settings')

- [x] **Step 2: Modify `memoria/config.py`**

Append at end of file:

```python
def get_effective_settings(db) -> dict:
    overrides = db.get_all_settings()
    fields = {
        "openai_base_url": str(settings.openai_base_url),
        "openai_api_key": str(settings.openai_api_key),
        "embedding_model": str(settings.embedding_model),
        "llm_model": str(settings.llm_model),
        "top_k": str(settings.top_k),
        "chunk_size": str(settings.chunk_size),
        "chunk_overlap": str(settings.chunk_overlap),
    }
    fields.update({k: v for k, v in overrides.items() if k in fields})
    return fields
```

- [x] **Step 3: Run config tests**

```bash
cd N:/Data/Projects/memoria
python -m pytest tests/test_config_override.py -v
```

Expected: all PASSED

- [x] **Step 4: Replace `memoria/server/deps.py`**

```python
import os
from functools import lru_cache

from memoria.config import settings, get_effective_settings
from memoria.core.embedder import Embedder, MockEmbedder
from memoria.core.pipeline import Pipeline
from memoria.llm.caller import LLMCaller, MockLLMCaller
from memoria.storage.db import DB

_pipeline: Pipeline | None = None


@lru_cache
def get_db() -> DB:
    os.makedirs(os.path.dirname(os.path.abspath(settings.db_path)), exist_ok=True)
    return DB(settings.db_path)


def get_pipeline() -> Pipeline:
    global _pipeline
    if _pipeline is None:
        db = get_db()
        effective = get_effective_settings(db)
        if settings.use_mock:
            embedder: Embedder | MockEmbedder = MockEmbedder()
            llm: LLMCaller | MockLLMCaller = MockLLMCaller()
        else:
            embedder = Embedder(effective["openai_base_url"], effective["openai_api_key"],
                                effective["embedding_model"])
            llm = LLMCaller(effective["openai_base_url"], effective["openai_api_key"],
                            effective["llm_model"])
        os.makedirs(settings.chroma_path, exist_ok=True)
        _pipeline = Pipeline(db=db, embedder=embedder, llm=llm, chroma_path=settings.chroma_path)
    return _pipeline


def reset_pipeline() -> None:
    global _pipeline
    _pipeline = None
```

- [x] **Step 5: Verify existing server tests still pass**

```bash
cd N:/Data/Projects/memoria
python -m pytest tests/test_server.py -v
```

Expected: all PASSED (dependency_overrides covers get_pipeline -- no test changes needed)

- [x] **Step 6: Commit**

```bash
cd N:/Data/Projects/memoria
git add memoria/config.py memoria/server/deps.py tests/test_config_override.py
git commit -m "feat: add get_effective_settings and resettable pipeline"
```

---

### Task 3: New Backend Routes + Sources Field

**Files:**
- Create: `memoria/server/routes/settings.py`
- Create: `memoria/server/routes/sessions.py`
- Modify: `memoria/server/routes/bots.py`
- Modify: `memoria/core/pipeline.py`
- Modify: `memoria/server/app.py`
- Modify: `tests/test_server.py`

**Interfaces:**
- Consumes:
  - `get_effective_settings(db: DB) -> dict` (Task 2)
  - `reset_pipeline() -> None` (Task 2)
  - `db.set_setting(key, value) -> None` (Task 1)
  - `db.list_sessions(bot_id) -> list[dict]` (Task 1)
  - `db.get_messages_all(session_id) -> list[dict]` (Task 1)
- Produces:
  - `GET /api/settings` -> `{openai_base_url, openai_api_key, embedding_model, llm_model, top_k, chunk_size, chunk_overlap}` (str values)
  - `PUT /api/settings` -> same shape (updated)
  - `GET /api/bots/{bot_id}/sessions` -> `list[{id, bot_id, created_at}]`, 404 if bot missing
  - `GET /api/sessions/{session_id}/messages` -> `list[{id, session_id, role, content, created_at}]`, 404 if session missing
  - `pipeline.query()` return value includes `sources: list[{text, score, doc_id}]`

- [x] **Step 1: Write failing tests**

Append to `tests/test_server.py`:

```python
def test_settings_get(client):
    r = client.get("/api/settings")
    assert r.status_code == 200
    data = r.json()
    assert "openai_base_url" in data
    assert "openai_api_key" in data
    assert "top_k" in data


def test_settings_put(client):
    r = client.put("/api/settings", json={"top_k": 8, "llm_model": "gpt-4o"})
    assert r.status_code == 200
    data = r.json()
    assert data["top_k"] == "8"
    assert data["llm_model"] == "gpt-4o"


def test_settings_put_skip_empty_api_key(client):
    r = client.put("/api/settings", json={"top_k": 3, "api_key": None})
    assert r.status_code == 200
    assert client.get("/api/settings").json()["openai_api_key"] == "mock"


def test_bot_sessions(client):
    kb = client.post("/api/knowledge-bases", json={"name": "kb", "description": ""}).json()
    bot = client.post("/api/bots", json={"name": "b", "system_prompt": "", "kb_ids": [kb["id"]]}).json()
    r = client.post(f"/api/chat/{bot['id']}", json={"message": "hello"})
    assert r.status_code == 200
    r2 = client.get(f"/api/bots/{bot['id']}/sessions")
    assert r2.status_code == 200
    assert len(r2.json()) == 1


def test_bot_sessions_not_found(client):
    r = client.get("/api/bots/nonexistent/sessions")
    assert r.status_code == 404


def test_session_messages(client):
    kb = client.post("/api/knowledge-bases", json={"name": "kb", "description": ""}).json()
    bot = client.post("/api/bots", json={"name": "b", "system_prompt": "", "kb_ids": [kb["id"]]}).json()
    r = client.post(f"/api/chat/{bot['id']}", json={"message": "hello"})
    session_id = r.json()["session_id"]
    r2 = client.get(f"/api/sessions/{session_id}/messages")
    assert r2.status_code == 200
    msgs = r2.json()
    assert len(msgs) == 2
    assert msgs[0]["role"] == "user"


def test_session_messages_not_found(client):
    r = client.get("/api/sessions/nonexistent/messages")
    assert r.status_code == 404


def test_chat_has_sources(client):
    kb = client.post("/api/knowledge-bases", json={"name": "kb", "description": ""}).json()
    bot = client.post("/api/bots", json={"name": "b", "system_prompt": "", "kb_ids": [kb["id"]]}).json()
    r = client.post(f"/api/chat/{bot['id']}", json={"message": "hello"})
    assert r.status_code == 200
    data = r.json()
    assert "sources" in data
    assert isinstance(data["sources"], list)
```

- [x] **Step 2: Run, confirm failure**

```bash
cd N:/Data/Projects/memoria
python -m pytest tests/test_server.py::test_settings_get tests/test_server.py::test_chat_has_sources -v
```

Expected: FAILED

- [x] **Step 3: Modify `memoria/core/pipeline.py` -- replace return in `query()`**

Replace the final `return` statement in `query()` (currently `return {"answer": answer, "context": context_chunks, "session_id": session_id}`) with:

```python
        return {
            "answer": answer,
            "session_id": session_id,
            "sources": [
                {"text": c["text"], "score": c["score"], "doc_id": c["metadata"]["doc_id"]}
                for c in context_chunks
            ],
        }
```

- [x] **Step 4: Create `memoria/server/routes/settings.py`**

```python
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from memoria.config import get_effective_settings
from memoria.server.deps import get_db, reset_pipeline
from memoria.storage.db import DB

router = APIRouter(prefix="/settings", tags=["settings"])


class SettingsUpdate(BaseModel):
    openai_base_url: Optional[str] = None
    api_key: Optional[str] = None
    embedding_model: Optional[str] = None
    llm_model: Optional[str] = None
    top_k: Optional[int] = None
    chunk_size: Optional[int] = None
    chunk_overlap: Optional[int] = None


@router.get("")
def get_settings(db: DB = Depends(get_db)):
    return get_effective_settings(db)


@router.put("")
def update_settings(body: SettingsUpdate, db: DB = Depends(get_db)):
    mapping = {
        "openai_base_url": body.openai_base_url,
        "openai_api_key": body.api_key,
        "embedding_model": body.embedding_model,
        "llm_model": body.llm_model,
        "top_k": str(body.top_k) if body.top_k is not None else None,
        "chunk_size": str(body.chunk_size) if body.chunk_size is not None else None,
        "chunk_overlap": str(body.chunk_overlap) if body.chunk_overlap is not None else None,
    }
    for key, value in mapping.items():
        if value is not None and value != "":
            db.set_setting(key, value)
    reset_pipeline()
    return get_effective_settings(db)
```

- [x] **Step 5: Create `memoria/server/routes/sessions.py`**

```python
from fastapi import APIRouter, Depends, HTTPException

from memoria.server.deps import get_db
from memoria.storage.db import DB

router = APIRouter(prefix="/sessions", tags=["sessions"])


@router.get("/{session_id}/messages")
def get_messages(session_id: str, db: DB = Depends(get_db)):
    if db.get_session(session_id) is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return db.get_messages_all(session_id)
```

- [x] **Step 6: Modify `memoria/server/routes/bots.py` -- append sessions subpath**

Append after `delete_bot` function:

```python
@router.get("/{bot_id}/sessions")
def list_bot_sessions(bot_id: str, db: DB = Depends(get_db)):
    if db.get_bot(bot_id) is None:
        raise HTTPException(status_code=404, detail="Bot not found")
    return db.list_sessions(bot_id)
```

- [x] **Step 7: Replace `memoria/server/app.py`**

```python
import logging
import os

from fastapi import FastAPI

from memoria.server.routes import bots, chat, documents, knowledge_bases, settings, sessions


def create_app() -> FastAPI:
    app = FastAPI(title="Memoria")
    app.include_router(knowledge_bases.router, prefix="/api")
    app.include_router(bots.router, prefix="/api")
    app.include_router(documents.router, prefix="/api")
    app.include_router(chat.router, prefix="/api")
    app.include_router(settings.router, prefix="/api")
    app.include_router(sessions.router, prefix="/api")

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    static_dir = os.path.join(os.path.dirname(__file__), "static")
    if os.path.isdir(static_dir):
        from fastapi.staticfiles import StaticFiles
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
    else:
        logging.warning("memoria/static/ not found -- Web UI unavailable. Run `npm run build` in web/.")

    return app


app = create_app()
```

- [x] **Step 8: Run full test suite**

```bash
cd N:/Data/Projects/memoria
python -m pytest tests/ -v
```

Expected: all PASSED

- [x] **Step 9: Commit**

```bash
cd N:/Data/Projects/memoria
git add memoria/core/pipeline.py memoria/server/routes/settings.py memoria/server/routes/sessions.py memoria/server/routes/bots.py memoria/server/app.py tests/test_server.py
git commit -m "feat: add settings/sessions routes, bot sessions subpath, sources in chat response"
```

---

### Task 4: Frontend Project Initialization

**Files:**
- Create: `web/` (entire new directory)

**Interfaces:**
- Produces:
  - `npm run dev`: serves at http://localhost:5173, `/api/*` proxied to http://localhost:8000
  - `npm run build`: outputs to `memoria/static/` (relative `../../memoria/static` from `web/`)

- [x] **Step 1: Initialize Vite React TypeScript project**

```bash
cd N:/Data/Projects/memoria
npm create vite@latest web -- --template react-ts
```

- [x] **Step 2: Install dependencies**

```bash
cd N:/Data/Projects/memoria/web
npm install
npm install react-router-dom @tanstack/react-query
npm install -D tailwindcss@3 postcss autoprefixer
npx tailwindcss init -p
```

- [x] **Step 3: Install shadcn/ui**

```bash
cd N:/Data/Projects/memoria/web
npx shadcn@latest init
```

Choose: Style=Default, Base color=Slate, CSS variables=yes

```bash
npx shadcn@latest add button input textarea card label select checkbox badge
```

- [x] **Step 4: Replace `web/vite.config.ts`**

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: '../../memoria/static',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
```

- [x] **Step 5: Ensure `web/tsconfig.json` includes path alias**

Add to `compilerOptions` if not already present:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
```

- [x] **Step 6: Verify TypeScript compiles**

```bash
cd N:/Data/Projects/memoria/web
npx tsc --noEmit
```

Expected: zero errors

- [x] **Step 7: Commit**

```bash
cd N:/Data/Projects/memoria
git add web/
git commit -m "feat: initialize React+Vite frontend with shadcn/ui"
```

---

### Task 5: api.ts

**Files:**
- Create: `web/src/api.ts`

**Interfaces:**
- Produces (all functions async, return Promise):
  - `listKBs() -> Promise<KB[]>`, `createKB(name, description) -> Promise<KB>`, `deleteKB(id) -> Promise<void>`
  - `listDocs(kbId) -> Promise<Doc[]>`, `uploadDocument(kbId, file) -> Promise<UploadResult>`, `deleteDocument(docId) -> Promise<void>`
  - `listBots() -> Promise<Bot[]>`, `createBot(data: BotCreate) -> Promise<Bot>`, `updateBot(id, data: BotUpdate) -> Promise<Bot>`, `deleteBot(id) -> Promise<void>`
  - `listSessions(botId) -> Promise<Session[]>`
  - `chat(botId, message, sessionId?) -> Promise<ChatResponse>`, `getMessages(sessionId) -> Promise<Message[]>`
  - `getSettings() -> Promise<Settings>`, `updateSettings(data) -> Promise<Settings>`

- [x] **Step 1: Create `web/src/api.ts`**

```typescript
const BASE = '/api'

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${path}`, init)
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  if (r.status === 204) return undefined as T
  return r.json()
}

export interface KB { id: string; name: string; description: string; created_at: string }
export interface Doc { id: string; kb_id: string; filename: string; chunk_count: number; created_at: string }
export interface UploadResult { doc_id: string; chunk_count: number; doc: Doc }
export interface Bot {
  id: string; name: string; system_prompt: string;
  model_override: string | null; kb_ids: string[]; created_at: string
}
export interface BotCreate { name: string; system_prompt?: string; kb_ids?: string[]; model_override?: string }
export interface BotUpdate { name?: string; system_prompt?: string; kb_ids?: string[]; model_override?: string }
export interface Session { id: string; bot_id: string; created_at: string }
export interface Message {
  id: string; session_id: string; role: 'user' | 'assistant'; content: string; created_at: string
}
export interface Source { text: string; score: number; doc_id: string }
export interface ChatResponse { answer: string; session_id: string; sources: Source[] }
export interface Settings {
  openai_base_url: string; openai_api_key: string; embedding_model: string;
  llm_model: string; top_k: string; chunk_size: string; chunk_overlap: string
}
export interface SettingsUpdate {
  openai_base_url?: string; api_key?: string; embedding_model?: string;
  llm_model?: string; top_k?: number; chunk_size?: number; chunk_overlap?: number
}

const json = (body: unknown) => ({
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const listKBs = () => req<KB[]>('/knowledge-bases')
export const createKB = (name: string, description: string) =>
  req<KB>('/knowledge-bases', { method: 'POST', ...json({ name, description }) })
export const deleteKB = (id: string) => req<void>(`/knowledge-bases/${id}`, { method: 'DELETE' })
export const listDocs = (kbId: string) => req<Doc[]>(`/knowledge-bases/${kbId}/documents`)
export const uploadDocument = (kbId: string, file: File) => {
  const fd = new FormData(); fd.append('file', file)
  return req<UploadResult>(`/knowledge-bases/${kbId}/documents`, { method: 'POST', body: fd })
}
export const deleteDocument = (docId: string) => req<void>(`/documents/${docId}`, { method: 'DELETE' })

export const listBots = () => req<Bot[]>('/bots')
export const createBot = (data: BotCreate) => req<Bot>('/bots', { method: 'POST', ...json(data) })
export const updateBot = (id: string, data: BotUpdate) =>
  req<Bot>(`/bots/${id}`, { method: 'PUT', ...json(data) })
export const deleteBot = (id: string) => req<void>(`/bots/${id}`, { method: 'DELETE' })
export const listSessions = (botId: string) => req<Session[]>(`/bots/${botId}/sessions`)

export const chat = (botId: string, message: string, sessionId?: string) =>
  req<ChatResponse>(`/chat/${botId}`, { method: 'POST', ...json({ message, session_id: sessionId }) })
export const getMessages = (sessionId: string) => req<Message[]>(`/sessions/${sessionId}/messages`)

export const getSettings = () => req<Settings>('/settings')
export const updateSettings = (data: SettingsUpdate) =>
  req<Settings>('/settings', { method: 'PUT', ...json(data) })
```

- [x] **Step 2: Verify TypeScript compiles**

```bash
cd N:/Data/Projects/memoria/web
npx tsc --noEmit
```

Expected: zero errors

- [x] **Step 3: Commit**

```bash
cd N:/Data/Projects/memoria
git add web/src/api.ts
git commit -m "feat: add api.ts REST client"
```

---

### Task 6: Layout + App Router + Page Stubs

**Files:**
- Create: `web/src/components/Layout.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/main.tsx`
- Create: `web/src/pages/KnowledgeBases.tsx` (stub)
- Create: `web/src/pages/Bots.tsx` (stub)
- Create: `web/src/pages/Chat.tsx` (stub)
- Create: `web/src/pages/Settings.tsx` (stub)

**Interfaces:**
- Produces: 4 routes `/knowledge-bases`, `/bots`, `/chat`, `/settings` with top nav switching

- [x] **Step 1: Create `web/src/components/Layout.tsx`**

```tsx
import { NavLink, Outlet } from 'react-router-dom'

const links = [
  { to: '/knowledge-bases', label: 'Knowledge Bases' },
  { to: '/bots', label: 'Bots' },
  { to: '/chat', label: 'Chat' },
  { to: '/settings', label: 'Settings' },
]

export default function Layout() {
  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b">
        <div className="container mx-auto flex h-14 items-center gap-6 px-4">
          <span className="font-semibold text-lg">Memoria</span>
          {links.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `text-sm transition-colors ${isActive ? 'text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'}`
              }
            >
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
      <main className="container mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
```

- [x] **Step 2: Create page stubs**

`web/src/pages/KnowledgeBases.tsx`:
```tsx
export default function KnowledgeBases() { return <div>Knowledge Bases</div> }
```

`web/src/pages/Bots.tsx`:
```tsx
export default function Bots() { return <div>Bots</div> }
```

`web/src/pages/Chat.tsx`:
```tsx
export default function Chat() { return <div>Chat</div> }
```

`web/src/pages/Settings.tsx`:
```tsx
export default function Settings() { return <div>Settings</div> }
```

- [x] **Step 3: Replace `web/src/App.tsx`**

```tsx
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Layout from './components/Layout'
import KnowledgeBases from './pages/KnowledgeBases'
import Bots from './pages/Bots'
import Chat from './pages/Chat'
import Settings from './pages/Settings'

const queryClient = new QueryClient()

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Navigate to="/knowledge-bases" replace />} />
            <Route path="knowledge-bases" element={<KnowledgeBases />} />
            <Route path="bots" element={<Bots />} />
            <Route path="chat" element={<Chat />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
```

- [x] **Step 4: Replace `web/src/main.tsx`**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [x] **Step 5: Verify compilation**

```bash
cd N:/Data/Projects/memoria/web
npx tsc --noEmit
```

Expected: zero errors

- [x] **Step 6: Commit**

```bash
cd N:/Data/Projects/memoria
git add web/src/
git commit -m "feat: add Layout, App router, and page stubs"
```

---

### Task 7: Knowledge Bases Page

**Files:**
- Modify: `web/src/pages/KnowledgeBases.tsx`

**Interfaces:**
- Consumes: `listKBs`, `createKB`, `deleteKB`, `listDocs`, `uploadDocument`, `deleteDocument`, `KB`, `Doc` (from `api.ts`)

- [x] **Step 1: Implement `web/src/pages/KnowledgeBases.tsx`**

```tsx
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import * as api from '@/api'

function DocList({ kbId }: { kbId: string }) {
  const qc = useQueryClient()
  const { data: docs = [] } = useQuery({ queryKey: ['docs', kbId], queryFn: () => api.listDocs(kbId) })
  const delDoc = useMutation({
    mutationFn: api.deleteDocument,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['docs', kbId] }),
  })
  const upload = useMutation({
    mutationFn: ({ file }: { file: File }) => api.uploadDocument(kbId, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['docs', kbId] }),
  })

  return (
    <div className="mt-3 space-y-2">
      <label className="cursor-pointer">
        <Button variant="outline" size="sm" asChild>
          <span>Upload Document (.md / .txt)</span>
        </Button>
        <input
          type="file"
          accept=".md,.txt"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) upload.mutate({ file })
            e.target.value = ''
          }}
        />
      </label>
      {docs.map(doc => (
        <div key={doc.id} className="flex items-center justify-between rounded border px-3 py-1.5 text-sm">
          <span>{doc.filename}</span>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{doc.chunk_count} chunks</Badge>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { if (confirm(`Delete document "${doc.filename}"?`)) delDoc.mutate(doc.id) }}
            >Delete</Button>
          </div>
        </div>
      ))}
    </div>
  )
}

export default function KnowledgeBases() {
  const qc = useQueryClient()
  const { data: kbs = [] } = useQuery({ queryKey: ['kbs'], queryFn: api.listKBs })
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')

  const createKB = useMutation({
    mutationFn: () => api.createKB(name.trim(), desc.trim()),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['kbs'] }); setName(''); setDesc('') },
  })
  const deleteKB = useMutation({
    mutationFn: api.deleteKB,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kbs'] }),
  })

  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Knowledge Bases</h1>
      <Card>
        <CardHeader><CardTitle className="text-base">Create Knowledge Base</CardTitle></CardHeader>
        <CardContent className="flex gap-2">
          <Input placeholder="Name" value={name} onChange={e => setName(e.target.value)} />
          <Input placeholder="Description (optional)" value={desc} onChange={e => setDesc(e.target.value)} />
          <Button onClick={() => createKB.mutate()} disabled={!name.trim() || createKB.isPending}>Create</Button>
        </CardContent>
      </Card>
      {kbs.map(kb => (
        <Card key={kb.id}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <button className="text-left font-medium hover:underline" onClick={() => toggle(kb.id)}>
                {kb.name} {expanded.has(kb.id) ? 'hide' : 'show docs'}
              </button>
              <Button
                variant="ghost" size="sm"
                onClick={() => { if (confirm(`Delete KB "${kb.name}"?`)) deleteKB.mutate(kb.id) }}
              >Delete</Button>
            </div>
            {kb.description && <p className="text-sm text-muted-foreground">{kb.description}</p>}
          </CardHeader>
          {expanded.has(kb.id) && (
            <CardContent><DocList kbId={kb.id} /></CardContent>
          )}
        </Card>
      ))}
    </div>
  )
}
```

- [x] **Step 2: Verify TypeScript compiles**

```bash
cd N:/Data/Projects/memoria/web
npx tsc --noEmit
```

Expected: zero errors

- [x] **Step 3: Commit**

```bash
cd N:/Data/Projects/memoria
git add web/src/pages/KnowledgeBases.tsx
git commit -m "feat: implement KnowledgeBases page"
```

---

### Task 8: Bots Page

**Files:**
- Modify: `web/src/pages/Bots.tsx`

**Interfaces:**
- Consumes: `listBots`, `listKBs`, `createBot`, `updateBot`, `deleteBot`, `Bot`, `BotCreate`, `BotUpdate`, `KB` (from `api.ts`)

- [x] **Step 1: Implement `web/src/pages/Bots.tsx`**

```tsx
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import * as api from '@/api'
import type { Bot } from '@/api'

function BotForm({
  initial, kbs, onSubmit, onCancel, isPending,
}: {
  initial?: Bot; kbs: api.KB[]
  onSubmit: (data: api.BotCreate) => void; onCancel?: () => void; isPending: boolean
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [prompt, setPrompt] = useState(initial?.system_prompt ?? '')
  const [selectedKBs, setSelectedKBs] = useState<Set<string>>(new Set(initial?.kb_ids ?? []))
  const [modelOverride, setModelOverride] = useState(initial?.model_override ?? '')

  const toggleKB = (id: string) => setSelectedKBs(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next
  })

  return (
    <div className="space-y-3">
      <Input placeholder="Bot name" value={name} onChange={e => setName(e.target.value)} />
      <Textarea placeholder="System Prompt" value={prompt} onChange={e => setPrompt(e.target.value)} rows={3} />
      <Input placeholder="model_override (optional)" value={modelOverride} onChange={e => setModelOverride(e.target.value)} />
      <div>
        <p className="text-sm font-medium mb-1">Associated Knowledge Bases</p>
        {kbs.map(kb => (
          <div key={kb.id} className="flex items-center gap-2">
            <Checkbox id={kb.id} checked={selectedKBs.has(kb.id)} onCheckedChange={() => toggleKB(kb.id)} />
            <Label htmlFor={kb.id}>{kb.name}</Label>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Button
          onClick={() => onSubmit({ name, system_prompt: prompt, kb_ids: [...selectedKBs], model_override: modelOverride || undefined })}
          disabled={!name.trim() || isPending}
        >{initial ? 'Save' : 'Create'}</Button>
        {onCancel && <Button variant="outline" onClick={onCancel}>Cancel</Button>}
      </div>
    </div>
  )
}

export default function Bots() {
  const qc = useQueryClient()
  const { data: bots = [] } = useQuery({ queryKey: ['bots'], queryFn: api.listBots })
  const { data: kbs = [] } = useQuery({ queryKey: ['kbs'], queryFn: api.listKBs })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const createBot = useMutation({
    mutationFn: api.createBot,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bots'] }); setShowCreate(false) },
  })
  const updateBot = useMutation({
    mutationFn: ({ id, data }: { id: string; data: api.BotUpdate }) => api.updateBot(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bots'] }); setEditingId(null) },
  })
  const deleteBot = useMutation({
    mutationFn: api.deleteBot,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bots'] }),
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Bots</h1>
        <Button onClick={() => setShowCreate(v => !v)}>+ New Bot</Button>
      </div>
      {showCreate && (
        <Card>
          <CardHeader><CardTitle className="text-base">New Bot</CardTitle></CardHeader>
          <CardContent>
            <BotForm kbs={kbs} onSubmit={data => createBot.mutate(data)} onCancel={() => setShowCreate(false)} isPending={createBot.isPending} />
          </CardContent>
        </Card>
      )}
      {bots.map(bot => (
        <Card key={bot.id}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">{bot.name}</CardTitle>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditingId(editingId === bot.id ? null : bot.id)}>
                  {editingId === bot.id ? 'Cancel' : 'Edit'}
                </Button>
                <Button variant="ghost" size="sm"
                  onClick={() => { if (confirm(`Delete bot "${bot.name}"?`)) deleteBot.mutate(bot.id) }}>Delete</Button>
              </div>
            </div>
          </CardHeader>
          {editingId === bot.id && (
            <CardContent>
              <BotForm initial={bot} kbs={kbs}
                onSubmit={data => updateBot.mutate({ id: bot.id, data })}
                onCancel={() => setEditingId(null)} isPending={updateBot.isPending} />
            </CardContent>
          )}
        </Card>
      ))}
    </div>
  )
}
```

- [x] **Step 2: Verify TypeScript compiles**

```bash
cd N:/Data/Projects/memoria/web
npx tsc --noEmit
```

Expected: zero errors

- [x] **Step 3: Commit**

```bash
cd N:/Data/Projects/memoria
git add web/src/pages/Bots.tsx
git commit -m "feat: implement Bots page with CRUD and KB multi-select"
```

---

### Task 9: Chat Page

**Files:**
- Modify: `web/src/pages/Chat.tsx`

**Interfaces:**
- Consumes: `listBots`, `listSessions`, `getMessages`, `chat`, `Bot`, `Session`, `Message`, `Source`, `ChatResponse` (from `api.ts`)

- [x] **Step 1: Implement `web/src/pages/Chat.tsx`**

```tsx
import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import * as api from '@/api'
import type { Source } from '@/api'

interface DisplayMessage {
  role: 'user' | 'assistant'
  content: string
  sources?: Source[]
}

function SourceList({ sources }: { sources: Source[] }) {
  const [open, setOpen] = useState(false)
  if (!sources.length) return null
  return (
    <div className="mt-1">
      <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setOpen(v => !v)}>
        Sources ({sources.length}) {open ? 'hide' : 'show'}
      </button>
      {open && (
        <div className="mt-1 space-y-1 rounded border p-2">
          {sources.map((s, i) => (
            <div key={i} className="text-xs">
              <span className="font-mono text-muted-foreground">{s.doc_id}</span>
              <Badge variant="outline" className="ml-2 text-xs">score: {s.score.toFixed(2)}</Badge>
              <p className="mt-0.5 text-muted-foreground line-clamp-2">{s.text}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Chat() {
  const { data: bots = [] } = useQuery({ queryKey: ['bots'], queryFn: api.listBots })
  const [botId, setBotId] = useState<string>('')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  const { data: sessions = [], refetch: refetchSessions } = useQuery({
    queryKey: ['sessions', botId],
    queryFn: () => api.listSessions(botId),
    enabled: !!botId,
  })

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const loadSession = async (sid: string) => {
    setSessionId(sid)
    const msgs = await api.getMessages(sid)
    setMessages(msgs.map(m => ({ role: m.role, content: m.content })))
  }

  const sendMsg = useMutation({
    mutationFn: () => api.chat(botId, input, sessionId ?? undefined),
    onMutate: () => { setMessages(prev => [...prev, { role: 'user', content: input }]); setInput('') },
    onSuccess: (data) => {
      if (!sessionId) { setSessionId(data.session_id); refetchSessions() }
      setMessages(prev => [...prev, { role: 'assistant', content: data.answer, sources: data.sources }])
    },
  })

  return (
    <div className="flex gap-4 h-[calc(100vh-8rem)]">
      <div className="w-48 flex flex-col gap-2">
        <Select value={botId} onValueChange={id => { setBotId(id); setSessionId(null); setMessages([]) }}>
          <SelectTrigger><SelectValue placeholder="Select Bot" /></SelectTrigger>
          <SelectContent>
            {bots.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {botId && (
          <>
            <Button variant="outline" size="sm" onClick={() => { setSessionId(null); setMessages([]) }}>
              + New Session
            </Button>
            <div className="flex-1 overflow-y-auto space-y-1">
              {sessions.map(s => (
                <button
                  key={s.id}
                  className={`w-full text-left rounded px-2 py-1 text-sm ${s.id === sessionId ? 'bg-accent' : 'hover:bg-muted'}`}
                  onClick={() => loadSession(s.id)}
                >
                  {s.created_at.slice(0, 16)}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      <div className="flex-1 flex flex-col">
        <div className="flex-1 overflow-y-auto space-y-3 rounded border p-4">
          {messages.map((m, i) => (
            <div key={i} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
              <div className={`max-w-[70%] rounded-lg px-3 py-2 text-sm ${m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                {m.content}
              </div>
              {m.role === 'assistant' && m.sources && <SourceList sources={m.sources} />}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
        <div className="mt-2 flex gap-2">
          <Input
            placeholder="Type a message..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && input.trim() && botId) sendMsg.mutate() }}
            disabled={!botId || sendMsg.isPending}
          />
          <Button onClick={() => sendMsg.mutate()} disabled={!botId || !input.trim() || sendMsg.isPending}>
            Send
          </Button>
        </div>
      </div>
    </div>
  )
}
```

- [x] **Step 2: Verify TypeScript compiles**

```bash
cd N:/Data/Projects/memoria/web
npx tsc --noEmit
```

Expected: zero errors

- [x] **Step 3: Commit**

```bash
cd N:/Data/Projects/memoria
git add web/src/pages/Chat.tsx
git commit -m "feat: implement Chat page with session management and sources display"
```

---

### Task 10: Settings Page

**Files:**
- Modify: `web/src/pages/Settings.tsx`

**Interfaces:**
- Consumes: `getSettings`, `updateSettings`, `Settings`, `SettingsUpdate` (from `api.ts`)

- [x] **Step 1: Implement `web/src/pages/Settings.tsx`**

```tsx
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import * as api from '@/api'
import type { SettingsUpdate } from '@/api'

export default function Settings() {
  const qc = useQueryClient()
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.getSettings })
  const [form, setForm] = useState<Partial<Record<string, string>>>({})
  const [showKey, setShowKey] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => { if (settings) setForm({ ...settings }) }, [settings])

  const update = useMutation({
    mutationFn: () => {
      const payload: SettingsUpdate = {
        openai_base_url: form.openai_base_url,
        embedding_model: form.embedding_model,
        llm_model: form.llm_model,
        top_k: form.top_k ? Number(form.top_k) : undefined,
        chunk_size: form.chunk_size ? Number(form.chunk_size) : undefined,
        chunk_overlap: form.chunk_overlap ? Number(form.chunk_overlap) : undefined,
      }
      // Only send api_key if user has changed it from the loaded value
      if (form.openai_api_key !== settings?.openai_api_key) {
        payload.api_key = form.openai_api_key
      }
      return api.updateSettings(payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    },
  })

  const field = (key: string, label: string, type = 'text') => (
    <div className="space-y-1">
      <Label htmlFor={key}>{label}</Label>
      {key === 'openai_api_key' ? (
        <div className="flex gap-2">
          <Input
            id={key}
            type={showKey ? 'text' : 'password'}
            value={form[key] ?? ''}
            onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
          />
          <Button variant="outline" size="sm" onClick={() => setShowKey(v => !v)}>
            {showKey ? 'Hide' : 'Show'}
          </Button>
        </div>
      ) : (
        <Input
          id={key}
          type={type}
          value={form[key] ?? ''}
          onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
        />
      )}
    </div>
  )

  return (
    <div className="max-w-lg space-y-4">
      <h1 className="text-xl font-semibold">Settings</h1>
      <Card>
        <CardHeader><CardTitle className="text-base">API Configuration</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {field('openai_base_url', 'OpenAI Base URL')}
          {field('openai_api_key', 'API Key')}
          {field('embedding_model', 'Embedding Model')}
          {field('llm_model', 'LLM Model')}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">RAG Parameters</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {field('top_k', 'Top-K', 'number')}
          {field('chunk_size', 'Chunk Size', 'number')}
          {field('chunk_overlap', 'Chunk Overlap', 'number')}
        </CardContent>
      </Card>
      <div className="flex items-center gap-3">
        <Button onClick={() => update.mutate()} disabled={update.isPending}>Save Settings</Button>
        {saved && <span className="text-sm text-green-600">Settings saved. Pipeline rebuilt.</span>}
      </div>
    </div>
  )
}
```

- [x] **Step 2: Verify TypeScript compiles**

```bash
cd N:/Data/Projects/memoria/web
npx tsc --noEmit
```

Expected: zero errors

- [x] **Step 3: Commit**

```bash
cd N:/Data/Projects/memoria
git add web/src/pages/Settings.tsx
git commit -m "feat: implement Settings page with api_key toggle and save notification"
```

---

### Task 11: Build and Integration Verification

**Files:** No new files

- [x] **Step 1: Build frontend**

```bash
cd N:/Data/Projects/memoria/web
npm run build
```

Expected: no errors, output at `N:/Data/Projects/memoria/memoria/static/` containing `index.html`

- [x] **Step 2: Verify static files**

```bash
ls N:/Data/Projects/memoria/memoria/static/
```

Expected: `index.html` and `assets/` directory present

- [x] **Step 3: Run full backend test suite**

```bash
cd N:/Data/Projects/memoria
python -m pytest tests/ -v
```

Expected: all PASSED

- [x] **Step 4: Start backend and verify UI accessible**

```bash
cd N:/Data/Projects/memoria
memoria serve
```

Open http://localhost:8000 in browser:
- Memoria nav bar visible
- http://localhost:8000/api/health returns `{"status": "ok"}`

Press Ctrl+C to stop.

- [x] **Step 5: End-to-end manual acceptance**

Start backend then perform in browser at http://localhost:8000:

1. **Knowledge Bases**: Create a KB -> expand -> upload a `.md` file -> confirm chunk count displayed
2. **Bots**: Create Bot associated with that KB
3. **Chat**: Select Bot -> send message -> receive answer -> expand Sources -> confirm doc_id and score shown
4. **History**: Refresh page -> select same Bot -> session appears in sidebar -> click to load history
5. **Settings**: Modify top_k to 3 -> Save -> see "Settings saved. Pipeline rebuilt." notification

- [x] **Step 6: Commit build artifacts**

```bash
cd N:/Data/Projects/memoria
git add memoria/static/
git commit -m "build: compile frontend to memoria/static"
```
