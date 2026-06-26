---
change: implement-phase1-rag-core
design-doc: docs/superpowers/specs/2026-06-26-implement-phase1-rag-core-design.md
base-ref: 1fef31b640942e6c32af0129e59a855128f32e42
status: archived-with-change
archived_at: 2026-06-26
---

# Memoria Phase 1 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**目标:** 填充所有 NotImplementedError stub，使 RAG 全流程端到端可运行，含多轮 session、mock 模式、REST API、CLI。

**架构:** Pipeline 类封装 DB/Embedder/LLM/ChromaStore；FastAPI deps.py 提供依赖注入；SQLite 存元数据，ChromaDB 存向量。

**Tech Stack:** Python 3.11, FastAPI, SQLAlchemy 2.0, ChromaDB, langchain-text-splitters, openai, click, pytest

## Global Constraints

- Python >= 3.11；仅支持 .md / .txt 文件；其他格式抛 ValueError / 返回 HTTP 422
- 所有 ID 使用 uuid4() 生成；chunk ID 格式: {doc_id}__{i}
- 每个 chunk 写入 Chroma metadata: {"doc_id": doc_id}
- 测试必须在 USE_MOCK=true 下通过，不依赖真实 API
- 运行测试命令: python -m pytest tests/ -q

---

### Task 1: SQLAlchemy ORM + DB 类

**Files:**
- Modify: `memoria/storage/db.py`
- Test: `tests/test_storage.py` (新建)

**Interfaces — Produces:**
`DB(db_path)`, `create_kb/get_kb/list_kbs/delete_kb`, `create_bot/get_bot/list_bots/update_bot/delete_bot`,
`create_doc/list_docs/delete_doc`, `create_session/get_session/get_messages/add_message`

- [x] **Step 1: 写 tests/test_storage.py**

```python
import pytest
from memoria.storage.db import DB

@pytest.fixture
def db(tmp_path):
    return DB(str(tmp_path / "test.db"))

def test_kb_crud(db):
    kb = db.create_kb("my-kb", "desc")
    assert kb["name"] == "my-kb"
    assert db.get_kb(kb["id"])["id"] == kb["id"]
    assert len(db.list_kbs()) == 1
    db.delete_kb(kb["id"])
    assert db.get_kb(kb["id"]) is None

def test_bot_crud(db):
    kb = db.create_kb("kb1", "")
    bot = db.create_bot("bot1", "prompt", [kb["id"]])
    assert bot["kb_ids"] == [kb["id"]]
    updated = db.update_bot(bot["id"], name="bot2")
    assert updated["name"] == "bot2"
    db.delete_bot(bot["id"])
    assert db.get_bot(bot["id"]) is None

def test_doc_crud(db):
    kb = db.create_kb("kb1", "")
    doc = db.create_doc(kb["id"], "a.md", "/tmp/a.md", 3)
    assert doc["chunk_count"] == 3
    assert len(db.list_docs(kb["id"])) == 1
    db.delete_doc(doc["id"])
    assert db.list_docs(kb["id"]) == []

def test_session_messages(db):
    bot = db.create_bot("b", "", [])
    sess = db.create_session(bot["id"])
    db.add_message(sess["id"], "user", "hello")
    db.add_message(sess["id"], "assistant", "hi")
    msgs = db.get_messages(sess["id"])
    assert len(msgs) == 2
    assert msgs[0]["role"] == "user"

def test_get_messages_limit(db):
    bot = db.create_bot("b", "", [])
    sess = db.create_session(bot["id"])
    for i in range(15):
        db.add_message(sess["id"], "user", f"msg{i}")
    msgs = db.get_messages(sess["id"], limit=10)
    assert len(msgs) == 10
```

- [x] **Step 2: 运行确认失败**

```bash
python -m pytest tests/test_storage.py -v
```

- [x] **Step 3: 实现 memoria/storage/db.py**

完整替换文件，包含 6 个 ORM 模型类和 DB 类。ORM 模型：
- KnowledgeBaseRow: id/name/description/created_at
- BotRow: id/name/system_prompt/model_override/created_at
- BotKBLink: bot_id FK + kb_id FK，联合主键
- DocumentRow: id/kb_id FK/filename/path/chunk_count/created_at
- SessionRow: id/bot_id FK/created_at
- MessageRow: id/session_id FK/role/content/created_at

DB.__init__ 使用 create_engine(f"sqlite:///{db_path}", check_same_thread=False)，调用 Base.metadata.create_all()。
所有方法使用 with self._Session() as s: 上下文管理器。
get_messages 按 created_at desc limit 后 reversed 返回（保持时间正序）。

参考 design doc 中的完整接口签名实现所有方法。

- [x] **Step 4: 运行测试确认通过**

```bash
python -m pytest tests/test_storage.py -v
```
预期：全部 PASS

- [x] **Step 5: 提交**

```bash
git add memoria/storage/db.py tests/test_storage.py
git commit -m "feat: implement SQLAlchemy ORM and DB class"
```


### Task 2: ChromaStore

**Files:**
- Modify: `memoria/storage/chroma_store.py`
- Test: `tests/test_chroma_store.py` (新建)

**Interfaces — Consumes:** ChromaDB 库 (import chromadb)
**Interfaces — Produces:** `ChromaStore(path, collection_name)`, `add(ids, embeddings, documents, metadatas)`, `query(embedding, k)->list[dict]`, `delete(where)`

- [x] **Step 1: 写 tests/test_chroma_store.py**

```python
import pytest
from memoria.storage.chroma_store import ChromaStore

@pytest.fixture
def store(tmp_path):
    return ChromaStore(str(tmp_path / "chroma"), "test_col")

def test_add_and_query(store):
    emb = [0.1] * 1536
    store.add(["id1"], [emb], ["hello world"], [{"doc_id": "doc1"}])
    results = store.query(emb, k=1)
    assert len(results) == 1
    assert results[0]["text"] == "hello world"
    assert "score" in results[0]
    assert results[0]["doc_id"] == "doc1"

def test_delete(store):
    emb = [0.1] * 1536
    store.add(["id1"], [emb], ["to delete"], [{"doc_id": "doc1"}])
    store.delete(where={"doc_id": "doc1"})
    results = store.query(emb, k=5)
    assert len(results) == 0
```

- [x] **Step 2: 运行确认失败**

```bash
python -m pytest tests/test_chroma_store.py -v
```

- [x] **Step 3: 实现 memoria/storage/chroma_store.py**

```python
import chromadb
from memoria.storage.base import VectorStore


class ChromaStore(VectorStore):
    def __init__(self, path: str, collection_name: str) -> None:
        self._client = chromadb.PersistentClient(path=path)
        self._col = self._client.get_or_create_collection(collection_name)

    def add(self, ids: list[str], embeddings: list[list[float]],
            documents: list[str], metadatas: list[dict] | None = None) -> None:
        self._col.add(ids=ids, embeddings=embeddings, documents=documents,
                      metadatas=metadatas or [{} for _ in ids])

    def query(self, embedding: list[float], k: int = 5) -> list[dict]:
        count = self._col.count()
        if count == 0:
            return []
        k = min(k, count)
        res = self._col.query(query_embeddings=[embedding], n_results=k,
                              include=["documents", "distances", "metadatas"])
        results = []
        for text, dist, meta in zip(res["documents"][0], res["distances"][0], res["metadatas"][0]):
            results.append({"text": text, "score": 1 - dist, "doc_id": meta.get("doc_id", "")})
        return results

    def delete(self, where: dict) -> None:
        self._col.delete(where=where)
```

- [x] **Step 4: 运行测试确认通过**

```bash
python -m pytest tests/test_chroma_store.py -v
```

- [x] **Step 5: 提交**

```bash
git add memoria/storage/chroma_store.py tests/test_chroma_store.py
git commit -m "feat: implement ChromaStore with persistent storage"
```


### Task 3: Chunker + Embedder + MockEmbedder

**Files:**
- Modify: `memoria/core/chunker.py`, `memoria/core/embedder.py`
- Test: `tests/test_core.py` (新建)

**Interfaces — Produces:**
- `Chunker(chunk_size, chunk_overlap)`, `split(path: str) -> list[str]`
- `Embedder(base_url, api_key, model)`, `embed(texts: list[str]) -> list[list[float]]`
- `MockEmbedder()`, `embed(texts) -> list[list[float]]` — 固定 1536 维随机向量

- [x] **Step 1: 写 tests/test_core.py**

```python
import pytest, os
from memoria.core.chunker import Chunker
from memoria.core.embedder import MockEmbedder

def test_chunker_md(tmp_path):
    f = tmp_path / "doc.md"
    f.write_text("# Title\n\n" + "word " * 300)
    chunks = Chunker(chunk_size=100, chunk_overlap=20).split(str(f))
    assert len(chunks) >= 2
    assert all(isinstance(c, str) and len(c) > 0 for c in chunks)

def test_chunker_txt(tmp_path):
    f = tmp_path / "doc.txt"
    f.write_text("hello " * 200)
    chunks = Chunker().split(str(f))
    assert len(chunks) >= 1

def test_chunker_unsupported(tmp_path):
    f = tmp_path / "doc.pdf"
    f.write_text("data")
    with pytest.raises(ValueError, match="Unsupported"):
        Chunker().split(str(f))

def test_chunker_missing_file():
    with pytest.raises(FileNotFoundError):
        Chunker().split("/nonexistent/file.md")

def test_mock_embedder():
    embs = MockEmbedder().embed(["hello", "world"])
    assert len(embs) == 2
    assert len(embs[0]) == 1536
    assert all(isinstance(v, float) for v in embs[0])
```

- [x] **Step 2: 运行确认失败**

```bash
python -m pytest tests/test_core.py -v
```

- [x] **Step 3: 实现 memoria/core/chunker.py**

```python
from langchain_text_splitters import RecursiveCharacterTextSplitter
from memoria.config import settings

SUPPORTED = {".md", ".txt"}

class Chunker:
    def __init__(self, chunk_size: int | None = None, chunk_overlap: int | None = None) -> None:
        self._splitter = RecursiveCharacterTextSplitter(
            chunk_size=chunk_size or settings.chunk_size,
            chunk_overlap=chunk_overlap or settings.chunk_overlap,
        )

    def split(self, path: str) -> list[str]:
        import os
        ext = os.path.splitext(path)[1].lower()
        if ext not in SUPPORTED:
            raise ValueError(f"Unsupported file format: {ext}. Supported: {SUPPORTED}")
        if not os.path.exists(path):
            raise FileNotFoundError(f"File not found: {path}")
        with open(path, encoding="utf-8") as f:
            text = f.read()
        return self._splitter.split_text(text)
```

- [x] **Step 4: 实现 memoria/core/embedder.py**

```python
import random
from openai import OpenAI

class Embedder:
    def __init__(self, base_url: str, api_key: str, model: str) -> None:
        self._client = OpenAI(base_url=base_url, api_key=api_key)
        self._model = model

    def embed(self, texts: list[str]) -> list[list[float]]:
        response = self._client.embeddings.create(input=texts, model=self._model)
        return [item.embedding for item in response.data]


class MockEmbedder:
    def embed(self, texts: list[str]) -> list[list[float]]:
        return [[random.random() for _ in range(1536)] for _ in texts]
```

- [x] **Step 5: 运行测试确认通过**

```bash
python -m pytest tests/test_core.py -v
```

- [x] **Step 6: 提交**

```bash
git add memoria/core/chunker.py memoria/core/embedder.py tests/test_core.py
git commit -m "feat: implement Chunker, Embedder, MockEmbedder"
```


### Task 4: LLMCaller + MockLLMCaller

**Files:**
- Modify: `memoria/llm/caller.py`
- Test: `tests/test_llm.py` (新建)

**Interfaces — Produces:**
- `LLMCaller(base_url, api_key, model)`, `call(messages, stream=False) -> dict | Iterator`
- `MockLLMCaller()`, `call(messages, stream=False) -> dict | Iterator`

- [x] **Step 1: 写 tests/test_llm.py**

```python
from memoria.llm.caller import MockLLMCaller

def test_mock_non_streaming():
    result = MockLLMCaller().call([{"role": "user", "content": "hi"}])
    assert result["content"] == "[mock response]"

def test_mock_streaming():
    chunks = list(MockLLMCaller().call([{"role": "user", "content": "hi"}], stream=True))
    assert "".join(chunks) == "[mock response]"
    assert len(chunks) > 1
```

- [x] **Step 2: 运行确认失败**

```bash
python -m pytest tests/test_llm.py -v
```

- [x] **Step 3: 实现 memoria/llm/caller.py**

```python
from typing import Iterator
from openai import OpenAI


class LLMCaller:
    def __init__(self, base_url: str, api_key: str, model: str) -> None:
        self._client = OpenAI(base_url=base_url, api_key=api_key)
        self._model = model

    def call(self, messages: list[dict], stream: bool = False) -> dict | Iterator:
        if stream:
            def _gen():
                resp = self._client.chat.completions.create(
                    model=self._model, messages=messages, stream=True)
                for chunk in resp:
                    delta = chunk.choices[0].delta.content
                    if delta:
                        yield delta
            return _gen()
        resp = self._client.chat.completions.create(model=self._model, messages=messages)
        return {"content": resp.choices[0].message.content}


class MockLLMCaller:
    _RESPONSE = "[mock response]"

    def call(self, messages: list[dict], stream: bool = False) -> dict | Iterator:
        if stream:
            return iter(self._RESPONSE)
        return {"content": self._RESPONSE}
```

- [x] **Step 4: 运行测试确认通过**

```bash
python -m pytest tests/test_llm.py -v
```

- [x] **Step 5: 提交**

```bash
git add memoria/llm/caller.py tests/test_llm.py
git commit -m "feat: implement LLMCaller and MockLLMCaller"
```

test with single quote: if not bot: return None

### Task 5: Config + Pipeline + deps.py

**Files:**
- Modify: `memoria/config.py`, `memoria/core/pipeline.py`, `memoria/server/deps.py`, `.env.example`
- Test: `tests/test_pipeline.py` (新建)

**Interfaces — Produces:** `settings.use_mock: bool`, `Pipeline(db, embedder, llm, chroma_path)`, `Pipeline.ingest/retrieve/query`, `get_db()`, `get_pipeline()`

- [x] **Step 1: 更新 memoria/config.py**

Settings 类新增字段 `use_mock: bool = False`，pydantic-settings 会从环境变量 `USE_MOCK` 读取（将 newapi_base_url 和 newapi_api_key 的默认值改为可选以便测试：`newapi_base_url: str = "http://localhost"`, `newapi_api_key: str = "mock"`）。

- [x] **Step 2: 追加 .env.example**

末尾新增一行：`USE_MOCK=false`

- [x] **Step 3: 写 tests/test_pipeline.py**

测试逻辑：
- fixture `pipeline(tmp_path)`: 创建 `DB(tmp_path/test.db)` + `MockEmbedder()` + `MockLLMCaller()` + `Pipeline(..., chroma_path=tmp_path/chroma)`
- `test_ingest`: 写 doc.md(100 words)，create_kb，ingest，断言 chunk_count>0，list_docs 返回 1 条，chunk_count 一致
- `test_retrieve_empty`: create_kb，retrieve 返回 []
- `test_query_single_turn`: ingest 文件，create_bot 关联 kb，query，断言 answer=="[mock response]"，session_id 存在
- `test_query_multi_turn`: 两次 query 复用 session_id，get_messages 返回 4 条
- `test_query_invalid_session`: query 传入不存在的 session_id 抛 ValueError

- [x] **Step 4: 运行确认失败**

```bash
python -m pytest tests/test_pipeline.py -v
```

- [x] **Step 5: 实现 memoria/core/pipeline.py**

实现 Pipeline 类（参考 design doc 第"核心类 Pipeline"和"数据流"节）：
- `__init__`: 保存 db/embedder/llm/chroma_path，初始化 `_stores: dict = {}`
- `_get_store(kb_id)`: 懒加载 ChromaStore，key 为 kb_id
- `ingest(kb_id, path)`: Chunker().split(path) → embed → ChromaStore.add(ids, vecs, chunks, metadatas) → db.create_doc → 返回 dict
  - doc_id = basename(path).replace(".",  "_") + "_" + kb_id[:8]
  - chunk ids: f"{doc_id}__{i}"
  - metadatas: [{"doc_id": doc_id} for each chunk]
- `retrieve(kb_id, query, k=None)`: embed([query])[0] → store.query(emb, k or settings.top_k)
- `query(bot_id, query, session_id=None)`: 按 design doc 数据流实现；session_id 不存在时抛 ValueError

- [x] **Step 6: 实现 memoria/server/deps.py**

```python
import os
from functools import lru_cache
from memoria.config import settings
from memoria.storage.db import DB
from memoria.core.pipeline import Pipeline
from memoria.core.embedder import Embedder, MockEmbedder
from memoria.llm.caller import LLMCaller, MockLLMCaller

@lru_cache
def get_db() -> DB:
    os.makedirs(os.path.dirname(os.path.abspath(settings.db_path)), exist_ok=True)
    return DB(settings.db_path)

@lru_cache
def get_pipeline() -> Pipeline:
    db = get_db()
    if settings.use_mock:
        embedder, llm = MockEmbedder(), MockLLMCaller()
    else:
        embedder = Embedder(settings.newapi_base_url, settings.newapi_api_key, settings.embedding_model)
        llm = LLMCaller(settings.newapi_base_url, settings.newapi_api_key, settings.llm_model)
    os.makedirs(settings.chroma_path, exist_ok=True)
    return Pipeline(db=db, embedder=embedder, llm=llm, chroma_path=settings.chroma_path)
```

- [x] **Step 7: 运行测试确认通过**

```bash
python -m pytest tests/test_pipeline.py -v
```

- [x] **Step 8: 提交**

```bash
git add memoria/config.py memoria/core/pipeline.py memoria/server/deps.py .env.example tests/test_pipeline.py
git commit -m "feat: implement Pipeline class, config use_mock, deps injection"
```

### Task 6: FastAPI Server 层

**Files:**
- Modify: `memoria/server/app.py`, `memoria/server/routes/knowledge_bases.py`, `memoria/server/routes/bots.py`, `memoria/server/routes/documents.py`, `memoria/server/routes/chat.py`
- Test: `tests/test_server.py` (新建)

**Interfaces — Consumes:** `get_db()`, `get_pipeline()` from deps.py

- [x] **Step 1: 实现 memoria/server/app.py**

```python
from fastapi import FastAPI
from memoria.server.routes import knowledge_bases, bots, documents, chat

def create_app() -> FastAPI:
    app = FastAPI(title="Memoria")
    app.include_router(knowledge_bases.router, prefix="/api")
    app.include_router(bots.router, prefix="/api")
    app.include_router(documents.router, prefix="/api")
    app.include_router(chat.router, prefix="/api")

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    return app

app = create_app()
```

- [x] **Step 2: 实现 memoria/server/routes/knowledge_bases.py**

Router prefix="/knowledge-bases"。端点：
- POST /: body={name,description}，创建 KB，返回 201
- GET /: 列出所有 KB
- GET /{kb_id}: 详情 + docs 列表
- DELETE /{kb_id}: 删除 KB（先删 Chroma collection，再删 SQLite），204

删除 KB 时调用 pipeline._get_store(kb_id)._client.delete_collection(f"kb_{kb_id}") 再 db.delete_kb(kb_id)。
404 时抛 HTTPException(status_code=404)。

- [x] **Step 3: 实现 memoria/server/routes/bots.py**

Router prefix="/bots"。端点：POST/GET/GET{id}/PUT{id}/DELETE{id}。
PUT 接收 {name?, system_prompt?, kb_ids?, model_override?}，调用 db.update_bot。
404 时抛 HTTPException(404)。

- [x] **Step 4: 实现 memoria/server/routes/documents.py**

Router prefix="/documents"。端点：
- POST /knowledge-bases/{kb_id}/documents: UploadFile，只允许 .md/.txt，保存到 settings.upload_dir/{kb_id}/，调用 pipeline.ingest()，返回 201
- GET /documents: 列表，支持 ?kb_id= 过滤
- DELETE /documents/{doc_id}: 删除文档 chunks（ChromaStore.delete where doc_id），再 db.delete_doc

文件格式检查：suffix not in {".md", ".txt"} 时抛 HTTPException(422)。

- [x] **Step 5: 实现 memoria/server/routes/chat.py**

Router prefix="/chat"。端点：
- POST /{bot_id}: body={message, session_id?}，调用 pipeline.query(bot_id, message, session_id)，返回 {answer, context, session_id}
- ValueError("session") 时返回 HTTPException(404)
- ValueError("Bot") 时返回 HTTPException(404)

- [x] **Step 6: 写 tests/test_server.py**

使用 FastAPI TestClient + dependency_overrides：

```python
import pytest
from fastapi.testclient import TestClient
from memoria.server.app import create_app
from memoria.server.deps import get_db, get_pipeline
from memoria.storage.db import DB
from memoria.core.pipeline import Pipeline
from memoria.core.embedder import MockEmbedder
from memoria.llm.caller import MockLLMCaller

@pytest.fixture
def client(tmp_path):
    db = DB(str(tmp_path / "test.db"))

    def _get_test_db():
        return db

    def _get_test_pipeline():
        return Pipeline(db=db, embedder=MockEmbedder(), llm=MockLLMCaller(),
                        chroma_path=str(tmp_path / "chroma"))

    app = create_app()
    app.dependency_overrides[get_db] = _get_test_db
    app.dependency_overrides[get_pipeline] = _get_test_pipeline
    return TestClient(app)

def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"

def test_kb_create_and_list(client):
    r = client.post("/api/knowledge-bases", json={"name": "kb1", "description": ""})
    assert r.status_code == 201
    kb_id = r.json()["id"]
    r2 = client.get("/api/knowledge-bases")
    assert any(k["id"] == kb_id for k in r2.json())

def test_kb_delete_not_found(client):
    r = client.delete("/api/knowledge-bases/nonexistent")
    assert r.status_code == 404

def test_bot_crud(client):
    kb = client.post("/api/knowledge-bases", json={"name": "kb", "description": ""}).json()
    bot = client.post("/api/bots", json={"name": "b", "system_prompt": "", "kb_ids": [kb["id"]]}).json()
    assert bot["kb_ids"] == [kb["id"]]
    r = client.put(f"/api/bots/{bot["id"]}", json={"name": "b2"})
    assert r.json()["name"] == "b2"
    client.delete(f"/api/bots/{bot["id"]}")
    assert client.get(f"/api/bots/{bot["id"]}").status_code == 404

def test_chat(client, tmp_path):
    kb = client.post("/api/knowledge-bases", json={"name": "kb", "description": ""}).json()
    bot = client.post("/api/bots", json={"name": "b", "system_prompt": "helpful", "kb_ids": [kb["id"]]}).json()
    r = client.post(f"/api/chat/{bot["id"]}", json={"message": "hello"})
    assert r.status_code == 200
    data = r.json()
    assert data["answer"] == "[mock response]"
    assert "session_id" in data

def test_upload_unsupported_format(client, tmp_path):
    kb = client.post("/api/knowledge-bases", json={"name": "kb", "description": ""}).json()
    f = tmp_path / "doc.pdf"
    f.write_bytes(b"data")
    with open(f, "rb") as fh:
        r = client.post(f"/api/knowledge-bases/{kb["id"]}/documents",
                        files={"file": ("doc.pdf", fh, "application/pdf")})
    assert r.status_code == 422
```

- [x] **Step 7: 运行测试确认通过**

```bash
python -m pytest tests/test_server.py -v
```

- [x] **Step 8: 提交**

```bash
git add memoria/server/ tests/test_server.py
git commit -m "feat: implement FastAPI routes and server app"
```

### Task 7: CLI 层

**Files:**
- Modify: `memoria/cli/main.py`

**Interfaces — Consumes:** `get_db()`, `get_pipeline()` from deps.py, uvicorn

- [x] **Step 1: 实现 memoria/cli/main.py**

完整替换文件内容：

```python
import click
import uvicorn
from memoria.server.deps import get_db, get_pipeline

@click.group()
def cli() -> None:
    """Memoria — Personal Knowledge Base Assistant."""

@cli.command()
@click.option("--host", default="0.0.0.0", show_default=True)
@click.option("--port", default=8000, show_default=True)
def serve(host: str, port: int) -> None:
    """Start the Memoria API server."""
    uvicorn.run("memoria.server.app:app", host=host, port=port, reload=False)

@cli.group()
def kb() -> None:
    """Knowledge base management."""

@kb.command("create")
@click.argument("name")
@click.option("--description", default="")
def kb_create(name: str, description: str) -> None:
    """Create a new knowledge base."""
    result = get_db().create_kb(name, description)
    click.echo(f"Created KB: {result["id"]} — {result["name"]}")

@kb.command("list")
def kb_list() -> None:
    """List all knowledge bases."""
    kbs = get_db().list_kbs()
    if not kbs:
        click.echo("No knowledge bases found.")
        return
    for k in kbs:
        click.echo(f"{k["id"]}  {k["name"]}  {k["description"]}")

@kb.command("delete")
@click.argument("kb_id")
def kb_delete(kb_id: str) -> None:
    """Delete a knowledge base."""
    get_db().delete_kb(kb_id)
    click.echo(f"Deleted KB: {kb_id}")

@cli.group()
def bot() -> None:
    """Bot management."""

@bot.command("create")
@click.argument("name")
@click.option("--system-prompt", default="")
def bot_create(name: str, system_prompt: str) -> None:
    """Create a new bot."""
    result = get_db().create_bot(name, system_prompt)
    click.echo(f"Created Bot: {result["id"]} — {result["name"]}")

@bot.command("list")
def bot_list() -> None:
    """List all bots."""
    bots = get_db().list_bots()
    if not bots:
        click.echo("No bots found.")
        return
    for b in bots:
        click.echo(f"{b["id"]}  {b["name"]}  kbs={b["kb_ids"]}")

@bot.command("delete")
@click.argument("bot_id")
def bot_delete(bot_id: str) -> None:
    """Delete a bot."""
    get_db().delete_bot(bot_id)
    click.echo(f"Deleted Bot: {bot_id}")

@cli.command()
@click.argument("kb_id")
@click.argument("path")
def ingest(kb_id: str, path: str) -> None:
    """Ingest a file into a knowledge base."""
    result = get_pipeline().ingest(kb_id, path)
    click.echo(f"Ingested: {result["chunk_count"]} chunks")

@cli.command()
@click.argument("bot_id")
@click.argument("question")
@click.option("--session-id", default=None)
def query(bot_id: str, question: str, session_id: str | None) -> None:
    """Query a bot."""
    result = get_pipeline().query(bot_id, question, session_id)
    click.echo(result["answer"])
    click.echo(f"[session_id: {result["session_id"]}]")
```

- [x] **Step 2: 验证 memoria --help 可运行**

```bash
memoriam --help
```
预期：输出帮助文本，退出码 0（注意包名 `memoria`）

```bash
memoriam kb --help
```
预期：输出 kb 子命令帮助

- [x] **Step 3: 提交**

```bash
git add memoria/cli/main.py
git commit -m "feat: implement CLI commands"
```

### Task 8: 全量测试验证

**Files:**
- Modify: `tests/conftest.py`

- [x] **Step 1: 更新 tests/conftest.py — 设置 USE_MOCK=true 环境变量**

```python
import os
import pytest
os.environ.setdefault("USE_MOCK", "true")
os.environ.setdefault("NEWAPI_BASE_URL", "http://localhost")
os.environ.setdefault("NEWAPI_API_KEY", "mock")
```

- [x] **Step 2: 运行全量测试确认通过**

```bash
python -m pytest tests/ -q
```

预期：所有测试通过（或仅有 warning），退出码 0。
若有失败，修复对应模块后重新运行。

- [x] **Step 3: 确认 memoria --help 正常**

```bash
memoriam --help
```

- [x] **Step 4: 提交**

```bash
git add tests/conftest.py
git commit -m "chore: set USE_MOCK=true in test conftest, verify full test suite passes"
```
