## Why

项目骨架已完成，但所有核心模块均为 `NotImplementedError` 占位。需要填充完整实现，使 RAG 全流程（ingest → retrieve → query → chat）可端到端运行，Phase 1 目标是验证基础召回质量并交付可用服务。

## What Changes

- 实现 `core/chunker.py`：RecursiveCharacterTextSplitter，支持 `.md` / `.txt` 文件读取
- 实现 `core/embedder.py`：调用 NewAPI（OpenAI-compatible）生成向量，支持 mock 模式
- 实现 `core/pipeline.py`：`ingest` / `retrieve` / `query` 三个核心函数
- 实现 `storage/db.py`：SQLAlchemy + SQLite，管理 bots / knowledge_bases / bot_kb_links / documents / sessions / messages 六张表
- 实现 `storage/chroma_store.py`：ChromaDB 持久化存储，add / query / delete
- 实现 `llm/caller.py`：LLMCaller，支持 streaming 和 non-streaming，支持 mock 模式
- 实现 `server/app.py`：注册全部路由，含 `/api/health`
- 实现 `server/routes/`：knowledge-bases / bots / documents / chat 全部端点
- 实现 `cli/main.py`：serve / kb / bot / ingest / query 命令
- 新增测试：mock 模式下 pytest 全部通过，不依赖真实 API key
- 新增 `use_mock` 配置项：通过 `.env` 中 `USE_MOCK=true` 启用 stub embedder 和 stub LLM

## Capabilities

### New Capabilities

- `rag-ingest`: 文件读取 → chunk → embed → 写入 ChromaDB，支持 .md/.txt
- `rag-retrieve`: 向量检索，按 kb_id 查询 top-k chunks
- `rag-query`: 多 KB 合并检索 → 拼 prompt → LLM 回答（单轮）
- `chat-session`: 有状态多轮对话，`session_id` 续聊，历史存 SQLite，拼入 prompt
- `kb-management`: 知识库 CRUD（REST API + CLI）
- `bot-management`: Bot CRUD，关联多个 KB（REST API + CLI）
- `document-management`: 文档上传入库、列表、删除（REST API）
- `mock-mode`: `USE_MOCK=true` 时使用 stub embedder 和 stub LLM，测试无需真实 API

### Modified Capabilities

- `project-skeleton`: 补充 `use_mock` 配置项（新增字段，非破坏性变更）

## Impact

- **代码**：填充所有 `NotImplementedError`，不新增模块（除测试文件）
- **依赖**：无需新增（所有依赖已在 `pyproject.toml` 中）
- **API**：新增 `/api/health` 端点；`/api/chat/{bot_id}` 支持 `session_id` 参数
- **数据库**：新增 sessions 和 messages 两张表（SQLite，首次启动自动建表）
- **配置**：`.env.example` 新增 `USE_MOCK=false`
