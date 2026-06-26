## 1. Storage 层

- [x] 1.1 实现 SQLAlchemy ORM 模型（bots/knowledge_bases/bot_kb_links/documents/sessions/messages 六张表）
- [x] 1.2 实现 `DB` 类：KB CRUD 方法（create_kb/get_kb/list_kbs/delete_kb）
- [x] 1.3 实现 `DB` 类：Bot CRUD 方法（create_bot/get_bot/list_bots/update_bot/delete_bot），含 bot_kb_links 同步
- [x] 1.4 实现 `DB` 类：Document 方法（create_doc/list_docs/delete_doc）
- [x] 1.5 实现 `DB` 类：Session/Message 方法（create_session/get_session/get_messages/add_message）
- [x] 1.6 实现 `ChromaStore`：add/query/delete，持久化到 `settings.chroma_path`

## 2. Core 层

- [x] 2.1 实现 `Chunker`：使用 RecursiveCharacterTextSplitter，读取 .md/.txt 文件，不支持的格式抛 ValueError
- [x] 2.2 实现真实 `Embedder`：调用 OpenAI-compatible API，批量 embed
- [x] 2.3 实现 `MockEmbedder`：返回固定 1536 维随机向量，不发 API 请求
- [x] 2.4 实现 `pipeline.ingest()`：读文件 → chunk → embed → 写 Chroma → 写 documents 表
- [x] 2.5 实现 `pipeline.retrieve()`：embed query → 查 Chroma → 返回 top-k chunks
- [x] 2.6 实现 `pipeline.query()`：多 KB retrieve → 合并排序 → 构建 prompt → LLM 调用 → 返回结果

## 3. LLM 层

- [x] 3.1 实现真实 `LLMCaller`：non-streaming 和 streaming 两种调用模式
- [x] 3.2 实现 `MockLLMCaller`：non-streaming 返回 `"[mock response]"`，streaming 逐字符 yield

## 4. 配置与依赖注入

- [x] 4.1 `config.py` 新增 `use_mock: bool = False`，从 `USE_MOCK` 环境变量读取
- [x] 4.2 `.env.example` 新增 `USE_MOCK=false`
- [x] 4.3 实现 `server/deps.py`：`get_db()` 和 `get_pipeline()` FastAPI 依赖

## 5. Server 层

- [x] 5.1 `server/app.py`：注册所有路由，添加 `/api/health` 端点
- [x] 5.2 实现 `routes/knowledge_bases.py`：POST/GET/GET/{id}/DELETE/{id}
- [x] 5.3 实现 `routes/bots.py`：POST/GET/GET/{id}/PUT/{id}/DELETE/{id}
- [x] 5.4 实现 `routes/documents.py`：POST upload（multipart）/GET（?kb_id=）/DELETE/{id}
- [x] 5.5 实现 `routes/chat.py`：POST `/api/chat/{bot_id}`，支持 session_id 续聊

## 6. CLI 层

- [x] 6.1 实现 `cli serve`：调用 uvicorn 启动 FastAPI app
- [x] 6.2 实现 `cli kb create/list/delete`
- [x] 6.3 实现 `cli bot create/list/delete`
- [x] 6.4 实现 `cli ingest`：调用 pipeline.ingest()
- [x] 6.5 实现 `cli query`：调用 pipeline.query() 并输出回答

## 7. 测试

- [x] 7.1 `tests/conftest.py`：fixture 提供 mock DB（内存 SQLite）和 MockPipeline，设置 `USE_MOCK=true`
- [x] 7.2 测试 storage 层：DB CRUD 各方法（内存 SQLite）
- [x] 7.3 测试 core 层：Chunker 切分、MockEmbedder、pipeline ingest/retrieve/query（mock 模式）
- [x] 7.4 测试 server 层：用 FastAPI TestClient 覆盖各路由（mock 依赖）
- [x] 7.5 测试 chat session：多轮对话历史正确拼入、session 不存在返回 404
- [x] 7.6 确认 `pytest tests/ -q` 在无 API key 环境下全部通过
