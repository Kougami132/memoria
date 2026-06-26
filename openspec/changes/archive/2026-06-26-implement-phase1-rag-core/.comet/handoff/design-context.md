# Comet Design Handoff

- Change: implement-phase1-rag-core
- Phase: design
- Mode: compact
- Context hash: e7767ce67594b7c1132157a863429c3153c45a85ba74fbe862701cd012e341df

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/implement-phase1-rag-core/proposal.md

- Source: openspec/changes/implement-phase1-rag-core/proposal.md
- Lines: 1-42
- SHA256: 02ba003f5d9383c0e9f806afb1c8b962a272c95b189bc68423739a0ef9d2df52

```md
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
```

## openspec/changes/implement-phase1-rag-core/design.md

- Source: openspec/changes/implement-phase1-rag-core/design.md
- Lines: 1-107
- SHA256: c768c4e24392c1f6a86e92d8576c7acaf6330016ab3c34e84a9da0661354639e

[TRUNCATED]

```md
## Context

项目骨架已就位（pyproject.toml、模型类、配置、路由骨架），所有核心模块均为 `NotImplementedError`。DESIGN.md 已定义架构和 ADR，本文档聚焦实现层决策。

## Goals / Non-Goals

**Goals:**
- 填充所有 stub 实现，使 RAG 全流程端到端可运行
- 有状态多轮对话（session_id + SQLite 消息历史）
- mock 模式：`USE_MOCK=true` 时用 stub 替换 embedder 和 LLM，测试无需真实 API
- 仅支持 `.md` / `.txt` 文件格式
- pytest 全部通过

**Non-Goals:**
- PDF / DOCX 解析
- Reranker
- Phase 2 Agentic RAG
- Web UI / QQ Bot 接入

## Decisions

### 1. SQLite Schema

6 张表，SQLAlchemy ORM 定义，首次启动 `Base.metadata.create_all()` 自动建表：

```
bots            (id TEXT PK, name TEXT, system_prompt TEXT, model_override TEXT, created_at TEXT)
knowledge_bases (id TEXT PK, name TEXT, description TEXT, created_at TEXT)
bot_kb_links    (bot_id TEXT FK, kb_id TEXT FK, PRIMARY KEY(bot_id, kb_id))
documents       (id TEXT PK, kb_id TEXT FK, filename TEXT, path TEXT, chunk_count INT, created_at TEXT)
sessions        (id TEXT PK, bot_id TEXT FK, created_at TEXT)
messages        (id TEXT PK, session_id TEXT FK, role TEXT, content TEXT, created_at TEXT)
```

使用 `uuid4()` 生成所有实体 ID。

### 2. Mock 模式实现

`config.py` 新增 `use_mock: bool = False`，从环境变量 `USE_MOCK` 读取。

- `MockEmbedder`：返回固定长度随机向量（与真实维度相同：1536）
- `MockLLMCaller`：返回固定字符串 `"[mock response]"`，streaming 版本逐字符 yield
- `pipeline.py` 的 `ingest`/`query` 根据 `settings.use_mock` 选择实现

### 3. 多轮对话 Session 设计

```
POST /api/chat/{bot_id}
Body: {"message": "...", "session_id": "optional"}

流程：
1. session_id 为空 → 创建新 session，返回新 session_id
2. 从 DB 查询该 session 的历史 messages（role: user/assistant）
3. 历史消息拼入 prompt（最近 N 条，N=10 默认）
4. 检索所有关联 KB → 合并 top-k chunks
5. 构建 messages 列表：system_prompt + 历史 + context + 当前问题
6. LLM 回答 → 存入 messages 表 → 返回
```

### 4. DB 封装方式

`storage/db.py` 不使用通用基类，直接按表实现具名方法：

```python
class DB:
    # KB
    def create_kb(self, name, description) -> KBRow
    def get_kb(self, kb_id) -> KBRow | None
    def list_kbs(self) -> list[KBRow]
    def delete_kb(self, kb_id) -> None
    # Bot
    def create_bot(self, name, system_prompt, kb_ids, model_override) -> BotRow
    def get_bot(self, bot_id) -> BotRow | None
    ...
    # Session / Messages
    def create_session(self, bot_id) -> SessionRow
    def get_messages(self, session_id, limit=10) -> list[MessageRow]
    def add_message(self, session_id, role, content) -> None
```

```

Full source: openspec/changes/implement-phase1-rag-core/design.md

## openspec/changes/implement-phase1-rag-core/tasks.md

- Source: openspec/changes/implement-phase1-rag-core/tasks.md
- Lines: 1-53
- SHA256: a0338f16df6ec705889d76606732d0693619d146b42b0ef0e4d54f5d2b7e78e0

```md
## 1. Storage 层

- [ ] 1.1 实现 SQLAlchemy ORM 模型（bots/knowledge_bases/bot_kb_links/documents/sessions/messages 六张表）
- [ ] 1.2 实现 `DB` 类：KB CRUD 方法（create_kb/get_kb/list_kbs/delete_kb）
- [ ] 1.3 实现 `DB` 类：Bot CRUD 方法（create_bot/get_bot/list_bots/update_bot/delete_bot），含 bot_kb_links 同步
- [ ] 1.4 实现 `DB` 类：Document 方法（create_doc/list_docs/delete_doc）
- [ ] 1.5 实现 `DB` 类：Session/Message 方法（create_session/get_session/get_messages/add_message）
- [ ] 1.6 实现 `ChromaStore`：add/query/delete，持久化到 `settings.chroma_path`

## 2. Core 层

- [ ] 2.1 实现 `Chunker`：使用 RecursiveCharacterTextSplitter，读取 .md/.txt 文件，不支持的格式抛 ValueError
- [ ] 2.2 实现真实 `Embedder`：调用 OpenAI-compatible API，批量 embed
- [ ] 2.3 实现 `MockEmbedder`：返回固定 1536 维随机向量，不发 API 请求
- [ ] 2.4 实现 `pipeline.ingest()`：读文件 → chunk → embed → 写 Chroma → 写 documents 表
- [ ] 2.5 实现 `pipeline.retrieve()`：embed query → 查 Chroma → 返回 top-k chunks
- [ ] 2.6 实现 `pipeline.query()`：多 KB retrieve → 合并排序 → 构建 prompt → LLM 调用 → 返回结果

## 3. LLM 层

- [ ] 3.1 实现真实 `LLMCaller`：non-streaming 和 streaming 两种调用模式
- [ ] 3.2 实现 `MockLLMCaller`：non-streaming 返回 `"[mock response]"`，streaming 逐字符 yield

## 4. 配置与依赖注入

- [ ] 4.1 `config.py` 新增 `use_mock: bool = False`，从 `USE_MOCK` 环境变量读取
- [ ] 4.2 `.env.example` 新增 `USE_MOCK=false`
- [ ] 4.3 实现 `server/deps.py`：`get_db()` 和 `get_pipeline()` FastAPI 依赖

## 5. Server 层

- [ ] 5.1 `server/app.py`：注册所有路由，添加 `/api/health` 端点
- [ ] 5.2 实现 `routes/knowledge_bases.py`：POST/GET/GET/{id}/DELETE/{id}
- [ ] 5.3 实现 `routes/bots.py`：POST/GET/GET/{id}/PUT/{id}/DELETE/{id}
- [ ] 5.4 实现 `routes/documents.py`：POST upload（multipart）/GET（?kb_id=）/DELETE/{id}
- [ ] 5.5 实现 `routes/chat.py`：POST `/api/chat/{bot_id}`，支持 session_id 续聊

## 6. CLI 层

- [ ] 6.1 实现 `cli serve`：调用 uvicorn 启动 FastAPI app
- [ ] 6.2 实现 `cli kb create/list/delete`
- [ ] 6.3 实现 `cli bot create/list/delete`
- [ ] 6.4 实现 `cli ingest`：调用 pipeline.ingest()
- [ ] 6.5 实现 `cli query`：调用 pipeline.query() 并输出回答

## 7. 测试

- [ ] 7.1 `tests/conftest.py`：fixture 提供 mock DB（内存 SQLite）和 MockPipeline，设置 `USE_MOCK=true`
- [ ] 7.2 测试 storage 层：DB CRUD 各方法（内存 SQLite）
- [ ] 7.3 测试 core 层：Chunker 切分、MockEmbedder、pipeline ingest/retrieve/query（mock 模式）
- [ ] 7.4 测试 server 层：用 FastAPI TestClient 覆盖各路由（mock 依赖）
- [ ] 7.5 测试 chat session：多轮对话历史正确拼入、session 不存在返回 404
- [ ] 7.6 确认 `pytest tests/ -q` 在无 API key 环境下全部通过
```

## openspec/changes/implement-phase1-rag-core/specs/bot-management/spec.md

- Source: openspec/changes/implement-phase1-rag-core/specs/bot-management/spec.md
- Lines: 1-27
- SHA256: 68ec9a6d7e31518ed92ab74027efaa5b7841be37a241293313c7b7b61bd431a3

```md
## ADDED Requirements

### Requirement: Bot CRUD（REST API）
系统 SHALL 提供完整的 Bot 管理端点，支持创建、查询、更新、删除，以及关联多个 KB。

#### Scenario: 创建 Bot
- **WHEN** POST `/api/bots` 传入 `{"name": "面试助手", "system_prompt": "...", "kb_ids": ["kb_1"]}`
- **THEN** 返回 201，含 Bot 完整信息及关联的 kb_ids

#### Scenario: 更新 Bot
- **WHEN** PUT `/api/bots/{bot_id}` 传入新的 `system_prompt` 或 `kb_ids`
- **THEN** 返回 200，Bot 信息更新，bot_kb_links 表同步更新

#### Scenario: 删除 Bot
- **WHEN** DELETE `/api/bots/{bot_id}`
- **THEN** 返回 204，Bot 及其 KB 关联关系从 SQLite 中删除

#### Scenario: 获取不存在的 Bot
- **WHEN** GET `/api/bots/nonexistent`
- **THEN** 返回 404

### Requirement: Bot CRUD（CLI）
系统 SHALL 提供 `memoria bot create/list/delete` CLI 命令。

#### Scenario: CLI 列出 Bot
- **WHEN** 运行 `memoria bot list`
- **THEN** 以表格形式输出所有 Bot，退出码 0
```

## openspec/changes/implement-phase1-rag-core/specs/chat-session/spec.md

- Source: openspec/changes/implement-phase1-rag-core/specs/chat-session/spec.md
- Lines: 1-30
- SHA256: 4892f4d99d4f23c6e36ece4fe8c30ab0be1dddc9dd7828b4cbd3dd06a1f55f18

```md
## ADDED Requirements

### Requirement: Session 创建
系统 SHALL 在首次对话时自动创建 session，返回 `session_id`，后续请求可用该 ID 续聊。

#### Scenario: 新对话自动创建 session
- **WHEN** POST `/api/chat/{bot_id}` 不传 `session_id`
- **THEN** 系统创建新 session，响应包含新生成的 `session_id`

#### Scenario: 续聊使用已有 session
- **WHEN** POST `/api/chat/{bot_id}` 传入已存在的 `session_id`
- **THEN** 系统加载该 session 的历史消息，拼入 prompt，回答基于上下文

#### Scenario: 不存在的 session_id
- **WHEN** POST `/api/chat/{bot_id}` 传入不存在的 `session_id`
- **THEN** 返回 404，提示 session 不存在

### Requirement: 消息历史持久化
系统 SHALL 将每轮对话的 user 消息和 assistant 回答存入 SQLite `messages` 表。

#### Scenario: 消息写入
- **WHEN** 一轮对话完成
- **THEN** `messages` 表新增 2 条记录：role=user 和 role=assistant，均关联正确的 session_id

### Requirement: 历史消息截断
系统 SHALL 最多取最近 10 条历史消息拼入 prompt，避免超出 LLM context 限制。

#### Scenario: 超长历史截断
- **WHEN** session 已有 20 条消息，发起新对话
- **THEN** 只有最近 10 条历史消息出现在 LLM 的 messages 列表中
```

## openspec/changes/implement-phase1-rag-core/specs/document-management/spec.md

- Source: openspec/changes/implement-phase1-rag-core/specs/document-management/spec.md
- Lines: 1-27
- SHA256: a0997072e19dfda5f1fe3d2a8228ea872d747edfc3b5e0a1bd3cfa857048097a

```md
## ADDED Requirements

### Requirement: 文档上传入库
系统 SHALL 接受 multipart 文件上传，保存到 `upload_dir`，并触发 `ingest()`。

#### Scenario: 上传 .md 文件
- **WHEN** POST `/api/knowledge-bases/{kb_id}/documents` 上传 .md 文件
- **THEN** 返回 201，文件保存成功，documents 表新增记录，Chroma 完成向量化

#### Scenario: 上传不支持的格式
- **WHEN** POST `/api/knowledge-bases/{kb_id}/documents` 上传 .pdf 文件
- **THEN** 返回 422，提示不支持该文件格式

#### Scenario: 上传到不存在的知识库
- **WHEN** POST `/api/knowledge-bases/nonexistent/documents` 上传文件
- **THEN** 返回 404

### Requirement: 文档列表与删除
系统 SHALL 提供文档列表查询和删除端点。

#### Scenario: 列出文档
- **WHEN** GET `/api/documents?kb_id={kb_id}`
- **THEN** 返回该 KB 下所有文档信息

#### Scenario: 删除文档
- **WHEN** DELETE `/api/documents/{doc_id}`
- **THEN** 返回 204，documents 表记录和 Chroma 中对应的 chunk 向量均被删除
```

## openspec/changes/implement-phase1-rag-core/specs/kb-management/spec.md

- Source: openspec/changes/implement-phase1-rag-core/specs/kb-management/spec.md
- Lines: 1-31
- SHA256: 757bc67d2444c909b8c3ec27a846a30288bfccd69e832cb0e51eac6e1b6c595b

```md
## ADDED Requirements

### Requirement: 知识库 CRUD（REST API）
系统 SHALL 提供 POST/GET/DELETE `/api/knowledge-bases` 端点管理知识库。

#### Scenario: 创建知识库
- **WHEN** POST `/api/knowledge-bases` 传入 `{"name": "简历", "description": "..."}`
- **THEN** 返回 201，含新建 KB 的 `id`、`name`、`description`、`created_at`

#### Scenario: 列出所有知识库
- **WHEN** GET `/api/knowledge-bases`
- **THEN** 返回 200，含所有 KB 的列表

#### Scenario: 获取知识库详情
- **WHEN** GET `/api/knowledge-bases/{kb_id}`
- **THEN** 返回 200，含该 KB 信息及其文档列表

#### Scenario: 删除知识库
- **WHEN** DELETE `/api/knowledge-bases/{kb_id}`
- **THEN** 返回 204，SQLite 中的 KB 记录和 Chroma collection 均被删除

#### Scenario: 删除不存在的知识库
- **WHEN** DELETE `/api/knowledge-bases/nonexistent`
- **THEN** 返回 404

### Requirement: 知识库 CRUD（CLI）
系统 SHALL 提供 `memoria kb create/list/delete` CLI 命令。

#### Scenario: CLI 创建知识库
- **WHEN** 运行 `memoria kb create "简历"`
- **THEN** 输出新建 KB 的 ID，退出码 0
```

## openspec/changes/implement-phase1-rag-core/specs/mock-mode/spec.md

- Source: openspec/changes/implement-phase1-rag-core/specs/mock-mode/spec.md
- Lines: 1-26
- SHA256: ba1b009abf44f4292ad3a9df49cb0584adfc9ff3fb7ec2ba4ab5539cf7724802

```md
## ADDED Requirements

### Requirement: Mock Embedder
当 `USE_MOCK=true` 时，系统 SHALL 使用 MockEmbedder 替代真实 Embedder，返回固定维度（1536）的随机向量，不发起任何 API 请求。

#### Scenario: Mock 模式下 ingest 成功
- **WHEN** `USE_MOCK=true`，调用 `ingest(kb_id, "doc.md")`
- **THEN** 完成切分和向量写入，不调用任何外部 API，函数正常返回

#### Scenario: 真实模式下使用真实 Embedder
- **WHEN** `USE_MOCK=false`（默认）
- **THEN** Embedder 使用 `settings.newapi_base_url` 和 `settings.newapi_api_key` 调用真实 API

### Requirement: Mock LLMCaller
当 `USE_MOCK=true` 时，系统 SHALL 使用 MockLLMCaller，`call()` 返回固定字符串 `"[mock response]"`，streaming 版本逐字符 yield，不发起任何 API 请求。

#### Scenario: Mock 模式下 query 返回固定回答
- **WHEN** `USE_MOCK=true`，调用 `query(bot_id, "任何问题")`
- **THEN** 返回 `answer="[mock response]"`，不调用外部 LLM API

### Requirement: 测试套件在 mock 模式下全部通过
系统 SHALL 在 `USE_MOCK=true` 环境下，`pytest tests/ -q` 全部通过，不依赖任何外部 API key 或网络连接。

#### Scenario: 无 API key 环境下测试通过
- **WHEN** 未设置 `NEWAPI_API_KEY`，设置 `USE_MOCK=true`，运行 `pytest tests/ -q`
- **THEN** 所有测试通过，退出码 0
```

## openspec/changes/implement-phase1-rag-core/specs/project-skeleton/spec.md

- Source: openspec/changes/implement-phase1-rag-core/specs/project-skeleton/spec.md
- Lines: 1-8
- SHA256: 05b0a76dd2f39b77766e16c1e73e7f891bb8e6b0826d31e3519d40ae7b5639a4

```md
## MODIFIED Requirements

### Requirement: 配置模板存在
项目 SHALL 提供 `.env.example` 文件，包含所有必要的配置项占位符，且不含真实密钥。新增 `USE_MOCK` 配置项。

#### Scenario: 配置模板完整性
- **WHEN** 用户查看 `.env.example`
- **THEN** 文件包含 NEWAPI_BASE_URL、NEWAPI_API_KEY、EMBEDDING_MODEL、LLM_MODEL、CHUNK_SIZE、CHUNK_OVERLAP、TOP_K、DB_PATH、CHROMA_PATH、UPLOAD_DIR、USE_MOCK 等配置项
```

## openspec/changes/implement-phase1-rag-core/specs/rag-ingest/spec.md

- Source: openspec/changes/implement-phase1-rag-core/specs/rag-ingest/spec.md
- Lines: 1-27
- SHA256: cbb0bd2c2234e0c3bdc1db32b8751ceeb5c795e06cdd5cc236b8ba256c33d58d

```md
## ADDED Requirements

### Requirement: 文件读取与切分
系统 SHALL 读取 `.md` 和 `.txt` 文件，使用 RecursiveCharacterTextSplitter 按 `chunk_size` 和 `chunk_overlap` 切分为文本片段。

#### Scenario: 成功 ingest .md 文件
- **WHEN** 调用 `ingest(kb_id, "doc.md")` 且文件存在
- **THEN** 文件被读取、切分为若干 chunk，每个 chunk 被向量化并写入对应 ChromaDB collection，返回含 chunk_count 的结果

#### Scenario: 成功 ingest .txt 文件
- **WHEN** 调用 `ingest(kb_id, "doc.txt")` 且文件存在
- **THEN** 流程与 .md 相同，正常完成

#### Scenario: 不支持的文件格式
- **WHEN** 调用 `ingest(kb_id, "doc.pdf")`
- **THEN** 抛出 ValueError，提示不支持该格式

#### Scenario: 文件不存在
- **WHEN** 调用 `ingest(kb_id, "nonexistent.md")`
- **THEN** 抛出 FileNotFoundError

### Requirement: 文档元数据持久化
ingest 完成后，系统 SHALL 在 SQLite `documents` 表中写入文档记录，包含 `kb_id`、`filename`、`path`、`chunk_count`。

#### Scenario: 元数据写入成功
- **WHEN** `ingest()` 成功完成
- **THEN** `documents` 表中存在对应记录，`chunk_count` 等于实际切分数量
```

## openspec/changes/implement-phase1-rag-core/specs/rag-query/spec.md

- Source: openspec/changes/implement-phase1-rag-core/specs/rag-query/spec.md
- Lines: 1-19
- SHA256: 42f2d80c3b9f3d4e5d0a8722c72738071ca5dbfdc83a5bd196bc9decfad56256

```md
## ADDED Requirements

### Requirement: RAG 单轮问答
系统 SHALL 执行完整 RAG 流程：检索关联 KB → 拼接 context → 调用 LLM → 返回回答。

#### Scenario: 正常单轮查询
- **WHEN** 调用 `query(bot_id, "问题")`
- **THEN** 返回含 `answer`、`context`（召回的 chunks）、`session_id` 的结果字典

#### Scenario: Bot 无关联 KB
- **WHEN** Bot 未关联任何 KB，调用 `query(bot_id, "问题")`
- **THEN** context 为空，仅凭 system_prompt 和问题调用 LLM，正常返回

### Requirement: Prompt 构建
系统 SHALL 将 Bot 的 `system_prompt`、检索到的 context chunks 和用户问题组装为标准 messages 列表后发送给 LLM。

#### Scenario: Prompt 包含 context
- **WHEN** 检索到 3 条 chunks
- **THEN** LLM 收到的 messages 包含 system 消息（含 context 文本）和 user 消息（原始问题）
```

## openspec/changes/implement-phase1-rag-core/specs/rag-retrieve/spec.md

- Source: openspec/changes/implement-phase1-rag-core/specs/rag-retrieve/spec.md
- Lines: 1-19
- SHA256: bd0f2cb6d14d924d0a0cdeac27ec7ada2529759329483a4817c8caf022063ec3

```md
## ADDED Requirements

### Requirement: 向量相似度检索
系统 SHALL 对给定 `kb_id` 和 `query` 文本执行向量相似度检索，返回 top-k 文本片段及相似度分数。

#### Scenario: 正常检索
- **WHEN** 调用 `retrieve(kb_id, "问题", k=5)`，且该 KB 已有向量数据
- **THEN** 返回最多 5 条 `{"text": ..., "score": ..., "doc_id": ...}` 结果，按相似度降序排列

#### Scenario: 空知识库检索
- **WHEN** 调用 `retrieve(kb_id, "问题")`，且该 KB 无任何向量数据
- **THEN** 返回空列表，不抛出异常

### Requirement: 多 KB 合并检索
`query()` 函数 SHALL 对 Bot 关联的所有 KB 分别执行 `retrieve()`，合并结果后取综合得分最高的 top-k 条。

#### Scenario: 多 KB 合并
- **WHEN** Bot 关联 2 个 KB，调用 `query(bot_id, "问题")`
- **THEN** 两个 KB 各自检索，结果合并后按分数排序，取前 `top_k` 条作为 context
```

