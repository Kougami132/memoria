---
comet_change: implement-phase1-rag-core
role: technical-design
canonical_spec: openspec
---

# Memoria Phase 1 实现 — 技术设计文档

## 概述

填充所有 `NotImplementedError` stub，使 RAG 全流程（ingest → retrieve → query → chat）端到端可运行。支持有状态多轮对话、mock 模式、`.md`/`.txt` 文件格式。

## 架构

```
CLI / FastAPI Routes
        │
        ▼
   Pipeline (class)
   ├── DB (SQLAlchemy + SQLite)
   ├── Embedder / MockEmbedder
   ├── LLMCaller / MockLLMCaller
   └── ChromaStore dict cache (kb_id → ChromaStore)
        │                    │
        ▼                    ▼
     SQLite               ChromaDB
  (元数据 6 张表)        (向量持久化)
```

### 核心类：`Pipeline`

```python
class Pipeline:
    def __init__(self, db: DB, embedder: Embedder, llm: LLMCaller, chroma_path: str): ...
    def ingest(self, kb_id: str, path: str) -> dict: ...
    def retrieve(self, kb_id: str, query: str, k: int = 5) -> list[dict]: ...
    def query(self, bot_id: str, query: str, session_id: str | None = None) -> dict: ...
    def _get_store(self, kb_id: str) -> ChromaStore: ...  # 懒加载缓存
```

`deps.py` 提供单例工厂：

```python
def get_db() -> DB: ...
def get_pipeline() -> Pipeline: ...
```

测试时通过 `app.dependency_overrides` 替换。

## SQLite Schema

6 张表，SQLAlchemy ORM，首次启动 `Base.metadata.create_all()` 自动建表，所有 ID 使用 `uuid4()`：

```
bots            (id, name, system_prompt, model_override, created_at)
knowledge_bases (id, name, description, created_at)
bot_kb_links    (bot_id FK, kb_id FK)  — 联合主键
documents       (id, kb_id FK, filename, path, chunk_count, created_at)
sessions        (id, bot_id FK, created_at)
messages        (id, session_id FK, role, content, created_at)
```

## 数据流

### Ingest

```
path → 读取文本 → RecursiveCharacterTextSplitter
  → chunks[]
  → Embedder.embed(chunks) → vectors[]
  → ChromaStore.add(ids, vectors, chunks, metadata={"doc_id": doc_id})
  → DB.create_doc(kb_id, filename, path, chunk_count)
```

Chunk ID 格式：`{doc_id}__{i}`。每个 chunk 写入 metadata `{"doc_id": doc_id}`，支持按 doc 过滤删除。

### Retrieve

```
query → Embedder.embed([query])[0]
  → ChromaStore.query(embedding, k) → [{text, score, doc_id}]
```

### Query（含多轮 session）

```
bot_id → DB.get_bot() → kb_ids[]
  → 并行 retrieve(kb_id, query, k=top_k) for each kb_id
  → 合并结果，按 score 降序取前 top_k 条
  → session_id 有值 → DB.get_messages(session_id, limit=10) → history[]
  → 构建 messages:
      [system: "{system_prompt}\n\n参考资料：\n{context}"]
      + history (role/content 原序)
      + [user: query]
  → LLMCaller.call(messages) → answer
  → DB.add_message(session_id, "user", query)
  → DB.add_message(session_id, "assistant", answer)
  → 返回 {answer, context, session_id}
```

## Mock 模式

`config.py` 新增 `use_mock: bool = False`（从 `USE_MOCK` 环境变量读取）。

`deps.py` 的 `get_pipeline()` 根据 `settings.use_mock` 选择实现：

```python
embedder = MockEmbedder() if settings.use_mock else Embedder(...)
llm = MockLLMCaller() if settings.use_mock else LLMCaller(...)
```

- `MockEmbedder`：`embed(texts)` 返回 `[[random float * 1536] for _ in texts]`
- `MockLLMCaller`：`call()` 返回 `{"content": "[mock response]"}`；streaming yield 逐字符

## REST API 端点

| 方法 | 路径 | 行为 |
|------|------|------|
| GET | `/api/health` | 返回 `{"status": "ok"}` |
| POST | `/api/knowledge-bases` | 创建 KB，201 |
| GET | `/api/knowledge-bases` | 列表 |
| GET | `/api/knowledge-bases/{id}` | 详情含文档列表 |
| DELETE | `/api/knowledge-bases/{id}` | 删除 KB + Chroma collection，204 |
| POST | `/api/bots` | 创建 Bot，201 |
| GET | `/api/bots` | 列表 |
| GET | `/api/bots/{id}` | 详情 |
| PUT | `/api/bots/{id}` | 更新，含 kb_ids 同步 |
| DELETE | `/api/bots/{id}` | 删除，204 |
| POST | `/api/knowledge-bases/{id}/documents` | 上传文件（multipart），触发 ingest，201 |
| GET | `/api/documents` | 列表，支持 `?kb_id=` 过滤 |
| DELETE | `/api/documents/{id}` | 删除文档 + Chroma chunks，204 |
| POST | `/api/chat/{bot_id}` | 对话，支持 `session_id` 续聊 |

文件上传仅允许 `.md` / `.txt`，其他格式返回 422。

## 测试策略

- 所有测试运行于 `USE_MOCK=true` 环境，无需真实 API key
- `conftest.py` 提供内存 SQLite DB fixture（`sqlite:///:memory:`）和 `mock_pipeline` fixture
- FastAPI 路由测试使用 `TestClient` + `app.dependency_overrides`
- 覆盖：storage CRUD、pipeline ingest/retrieve/query、所有路由、多轮 session

## 实现顺序

1. Storage 层（DB ORM + ChromaStore）
2. Core 层（Chunker、Embedder、Mock 实现、Pipeline 类）
3. LLM 层（LLMCaller、MockLLMCaller）
4. 配置与依赖注入（config.py、deps.py）
5. Server 层（app.py 路由注册、各 routes）
6. CLI 层
7. 测试
