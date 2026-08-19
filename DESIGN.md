# Memoria — 技术设计文档

> Bot 管理平台 + RAG 引擎
> 作者：kougami
> 状态：Phase 1 已完成

---

## 零、设计原则

1. **长时运行的服务是主模式** — `memoria serve` 启动，对外暴露 REST API。其他交互方式（Web UI、CLI）统一通过 API 调用引擎
2. **CLI 仅为调试工具** — 开发阶段方便手动测试，不承载核心交互
3. **可集成第一** — 现有系统只需调 HTTP 接口即可接入 Bot 能力
4. **引擎与交互层完全解耦** — RAG 引擎是独立的 Python 库，服务 / CLI 都导入它
5. **Bot 是核心抽象** — 每个 Bot 是一个独立 AI 助手，可关联多个知识库，对外暴露统一对话入口
6. **渐进式演进** — Phase 1 手写简单 RAG Loop 跑通全流程，Phase 2 引入 Agent SDK 升级为 AI Agent

---

## 一、核心概念与术语

| 术语 | 定义 |
|------|------|
| **Document** | 原始文件（.md / .txt），用户上传或通过 Vault 同步的源材料 |
| **Chunk** | 文档切分后的文本片段，是向量化和检索的基本单元 |
| **Embedding** | Chunk 经模型转换后的浮点数向量 |
| **Knowledge Base** | 一个 Chroma collection，包含一批文档的向量索引。独立管理，独立检索。分 `upload`（手动上传）和 `vault`（自动同步）两种类型 |
| **Bot** | 对外暴露的 AI 助手。关联 N 个 Knowledge Base，拥有独立的 System Prompt |
| **Session** | 对话会话，关联一个 Bot，持久化多轮消息历史 |
| **Vault** | 绑定到 `vault` 类型 KB 的文件源（本地目录或 WebDAV），支持自动周期同步 |

### 实体关系

```
Document (N) ──belongs to──> (1) Knowledge Base
Bot (N) <──associates──> (M) Knowledge Base  (多对多)
Bot (1) ──has──> (N) Session
Session (1) ──has──> (N) Message
Knowledge Base (1) ──may bind──> (0..1) Vault
```

---

## 二、系统架构概览

```
┌────────────────────────────────────────────────────────────────────┐
│                         调用方                                      │
│              Web UI (内嵌) / curl / 任何 HTTP 客户端                │
└──────────────────────┬─────────────────────────────────────────────┘
                       │ HTTP (REST API / SPA)
                       ▼
┌────────────────────────────────────────────────────────────────────┐
│                   Memoria Service (FastAPI)                         │
│                                                                     │
│  ┌─ 管理 API ──────────────────┐  ┌─ 对话 API ──────────────────┐  │
│  │  /api/knowledge-bases       │  │  POST /api/chat/{bot_id}    │  │
│  │  /api/bots                  │  │  GET  /api/sessions/{bot}   │  │
│  │  /api/documents             │  │  GET  /api/sessions/{id}/   │  │
│  │  /api/sessions/{id}         │  │       messages              │  │
│  │  /api/settings              │  │  DELETE /api/sessions/{id}  │  │
│  │  /api/knowledge-bases/{id}/ │  └─────────────────────────────┘  │
│  │    vault (+ /sync)          │                                    │
│  └─────────────────────────────┘                                   │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │               memoria 核心库 (Python Package)                 │  │
│  │  core/pipeline.py  ← ingest / retrieve / query 编排          │  │
│  │  core/chunker.py   ← 文本切分 (RecursiveCharacterTextSplitter)│  │
│  │  core/embedder.py  ← embedding 调用                          │  │
│  │  storage/          ← Chroma collection 操作                  │  │
│  │  llm/caller.py     ← LLM 调用 (OpenAI 兼容)                  │  │
│  │  vault/syncer.py   ← Vault 同步编排                           │  │
│  │  vault/connector.py← Local / WebDAV 文件源适配器              │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  APScheduler — 每 N 分钟轮询触发 auto_sync Vault                    │
└──────────────────────┬──────────────────────────────────────────────┘
                       │
          ┌────────────┴────────────┐
          ▼                         ▼
┌──────────────────┐     ┌──────────────────────┐
│  SQLite (元数据)  │     │  Chroma (向量)        │
│                  │     │                      │
│  bots            │     │  kb_<id>             │
│  knowledge_bases │     │  (每个 KB 一个        │
│  bot_kb_links    │     │   collection)        │
│  documents       │     │                      │
│  sessions        │     └──────────────────────┘
│  messages        │
│  vaults          │
│  vault_files     │
│  settings        │
└──────────────────┘
```

### Web UI

内嵌于服务，构建产物放入 `memoria/static/`，服务启动后通过 `http://localhost:8000` 访问。

- **Chat** — 左侧会话列表（新建 / 切换 / 删除）+ 右侧对话区（Markdown 渲染 / 消息来源展示）
- **Knowledge Bases** — 知识库列表 / 文档上传删除 / Vault 绑定同步
- **Bots** — Bot 创建 / 关联 KB / System Prompt 编辑
- **Settings** — API 地址 / Key / RAG 参数 / Vault 同步间隔（含连接测试）

---

## 三、接口契约

### 3.1 REST API

#### 知识库管理

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/knowledge-bases` | 创建 KB，`type` 字段为 `upload`（默认）或 `vault` |
| `GET` | `/api/knowledge-bases` | 列出所有 KB |
| `GET` | `/api/knowledge-bases/{kb_id}` | KB 详情 |
| `DELETE` | `/api/knowledge-bases/{kb_id}` | 删除 KB 及其向量 |

#### Vault 管理

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/knowledge-bases/{kb_id}/vault` | 绑定 Vault（local / webdav），触发初始同步 |
| `GET` | `/api/knowledge-bases/{kb_id}/vault` | 查看 Vault 状态 |
| `PATCH` | `/api/knowledge-bases/{kb_id}/vault` | 更新 auto_sync 配置 |
| `DELETE` | `/api/knowledge-bases/{kb_id}/vault` | 解绑 Vault，清除同步文档 |
| `POST` | `/api/knowledge-bases/{kb_id}/vault/sync` | 手动触发同步 |
| `DELETE` | `/api/knowledge-bases/{kb_id}/vault/sync` | 取消正在进行的同步 |

#### Bot 管理

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/bots` | 创建 Bot |
| `GET` | `/api/bots` | 列出所有 Bot |
| `GET` | `/api/bots/{bot_id}` | Bot 详情 |
| `PUT` | `/api/bots/{bot_id}` | 更新 Bot 配置 |
| `DELETE` | `/api/bots/{bot_id}` | 删除 Bot 及其会话 |

#### 文档管理

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/knowledge-bases/{kb_id}/documents` | 上传文档（multipart）|
| `GET` | `/api/documents?kb_id=` | 文档列表，可按 KB 过滤 |
| `DELETE` | `/api/documents/{doc_id}` | 删除文档及其向量 |

#### 对话与会话

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/chat/{bot_id}` | 对话，可传 `session_id` 续聊 |
| `GET` | `/api/sessions/{bot_id}` | 列出 Bot 的所有会话 |
| `GET` | `/api/sessions/{session_id}/messages` | 拉取会话全量消息 |
| `DELETE` | `/api/sessions/{session_id}` | 删除会话及其消息 |

#### 设置

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/settings` | 获取当前生效设置 |
| `PATCH` | `/api/settings` | 更新设置（DB 覆盖层，优先于 .env）|
| `POST` | `/api/settings/test-embed` | 测试 embedding 连通性 |
| `POST` | `/api/settings/test-chat` | 测试 LLM 连通性 |

#### 健康检查

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/health` | 返回 `{"status": "ok"}` |

### 3.2 CLI（调试工具）

```
memoria serve [--host] [--port] [--log-file]  # 启动服务
memoria kb create <name>                       # 创建知识库
memoria kb list                                # 列出知识库
memoria kb delete <kb_id>                      # 删除知识库
memoria bot create <name> [--system-prompt]    # 创建 Bot
memoria bot list                               # 列出 Bot
memoria bot delete <bot_id>                    # 删除 Bot
memoria ingest <kb_id> <path>                  # 单文件/目录入库
memoria query <bot_id> "<问题>" [--session-id] # 对话
```

### 3.3 RAG 引擎（Python API）

核心库直接可导入，CLI 和测试不走 HTTP：

```python
pipeline.ingest(kb_id, path)                    # 入库
pipeline.retrieve(kb_id, query, k)              # 检索
pipeline.query(bot_id, question, session_id)    # 完整 RAG 问答
```

---

## 四、数据流

### 对话流程

```
POST /api/chat/{bot_id} {"message": "...", "session_id": "..."}
      │
      ├─ ① 查 SQLite → Bot 配置 (system_prompt, kb_ids)
      ├─ ② 加载 Session 历史（最近 10 条）
      ├─ ③ 对所有关联 KB 检索，取 top-k chunks（score ≥ min_score）
      ├─ ④ 拼 Prompt = system_prompt + context + 历史 + 用户消息
      ├─ ⑤ 调 LLM → answer
      ├─ ⑥ 写入 messages 表（user + assistant 各一条）
      └─ ⑦ 返回 {answer, session_id, sources}
```

### 文档入库流程

```
POST /api/knowledge-bases/{kb_id}/documents (multipart)
      │
      ├─ ① 存原始文件到 data/uploads/
      ├─ ② 记录 documents 表元数据
      ├─ ③ RecursiveCharacterTextSplitter 切分
      ├─ ④ Embedding API 向量化
      └─ ⑤ 写入 Chroma collection "kb_{kb_id}"
```

### Vault 同步流程

```
触发方式：绑定时初始同步 / 手动触发 / APScheduler 周期轮询
      │
      ├─ ① Connector.list_files() → 远端文件列表
      ├─ ② 对比 vault_files 表 → 计算新增 / 已删除文件
      ├─ ③ 新增文件 → 入库（同上传流程）
      ├─ ④ 已删除文件 → 删除 Chroma 向量 + documents 记录
      └─ ⑤ 更新 vault_files 表记录
```

---

## 五、关键技术决策（ADRs）

### ADR-001：Embedding 模型

**决策**：`text-embedding-3-large`（OpenAI 兼容 API，通过 `openai_base_url` 配置）
- 可逆：切换模型只需改配置并重跑 ingest

### ADR-002：向量数据库

**决策**：ChromaDB（本地持久化）
- 零配置，pip 安装即用；存储层已抽象，可替换

### ADR-003：Chunking 策略

**决策**：`RecursiveCharacterTextSplitter`，默认 chunk_size=512 / overlap=128
- 参数可通过 Settings API 或 .env 调整

### ADR-004：Reranker

**决策**：Phase 1 不引入；各 KB 分别取 top-k 合并后按分数过滤

### ADR-005：元数据存储

**决策**：SQLite + SQLAlchemy；零部署，量小，可后续迁移至 PostgreSQL

### ADR-006：双存储架构

**决策**：SQLite 管元数据，Chroma 管向量，通过 `kb_id` 关联
- 应用层保证一致性（删除时先删 Chroma 后删 SQLite）

### ADR-007：Vault 级联删除

**决策**：应用层删除（与 `delete_bot`、`delete_kb` 保持一致），不用 DB 外键 CASCADE
- `synchronize_session=False` 避免事件传播开销

### ADR-008：Settings 覆盖层

**决策**：`.env` 设静态默认值，DB `settings` 表存运行时覆盖，`get_effective_settings()` 合并两层
- Web UI 保存的设置立即生效，无需重启

### ADR-009：Vault 同步调度

**决策**：APScheduler AsyncIOScheduler，间隔默认 15 分钟，可通过 Settings 调整
- `auto_sync=False` 的 Vault 跳过周期轮询，只响应手动触发

---

## 六、配置

### 6.1 .env 配置项

```ini
# API 连接（必填）
OPENAI_BASE_URL=https://your-api.example.com
OPENAI_API_KEY=sk-xxxxx

# 模型
EMBEDDING_MODEL=text-embedding-3-large
LLM_MODEL=deepseek-v4-flash

# RAG 参数
CHUNK_SIZE=512
CHUNK_OVERLAP=128
TOP_K=5
MIN_SCORE=0.5

# 存储路径
DB_PATH=./data/memoria.db
CHROMA_PATH=./data/chroma
UPLOAD_DIR=./data/uploads
LOG_PATH=./data/memoria.log

# 开发调试
USE_MOCK=false   # true 时跳过真实 API 调用，返回固定占位响应
```

提供 `.env.example` 作为模板（进 Git）。以上所有参数也可在 Web UI 的「系统设置」页面运行时覆盖，优先级高于 .env。

### 6.2 文件格式支持

| 格式 | 支持 |
|------|------|
| `.md` | ✅ |
| `.txt` | ✅ |
| `.pdf` | ❌ |
| `.docx` | ❌ |

---

## 七、项目结构

```
memoria/
├── memoria/                        # 核心 Python 包
│   ├── core/                       # RAG 引擎
│   │   ├── pipeline.py             # ingest / retrieve / query 编排
│   │   ├── chunker.py              # 文本切分
│   │   └── embedder.py             # embedding 调用
│   ├── storage/
│   │   ├── base.py                 # VectorStore 抽象基类
│   │   ├── chroma_store.py         # Chroma 实现
│   │   └── db.py                   # SQLite 元数据 CRUD
│   ├── models/                     # Pydantic 数据模型
│   ├── llm/caller.py               # LLM 调用（OpenAI 兼容）
│   ├── vault/
│   │   ├── connector.py            # LocalConnector / WebDAVConnector
│   │   └── syncer.py               # Vault 同步编排
│   ├── server/
│   │   ├── app.py                  # FastAPI 应用 + APScheduler 生命周期
│   │   ├── deps.py                 # 依赖注入
│   │   └── routes/                 # 各功能路由模块
│   │       ├── bots.py
│   │       ├── chat.py
│   │       ├── documents.py
│   │       ├── knowledge_bases.py
│   │       ├── sessions.py
│   │       ├── settings.py
│   │       └── vaults.py
│   ├── cli/main.py                 # Click CLI 入口
│   ├── static/                     # Web UI 构建产物（git 忽略，构建生成）
│   └── config.py                   # pydantic-settings + get_effective_settings()
├── web/                            # React + Vite 前端源码
│   └── src/
│       ├── pages/                  # Chat / KnowledgeBases / Bots / Settings
│       ├── components/             # Layout + shadcn/ui 组件
│       └── api.ts                  # 前端 API 客户端
├── tests/                          # pytest 集成测试
├── data/                           # Git 忽略，运行时数据
│   ├── memoria.db
│   ├── chroma/
│   └── uploads/
├── openspec/                       # OpenSpec 规格与变更记录
├── docs/                           # Superpowers 设计文档和验证报告
├── .env.example
├── pyproject.toml
├── DESIGN.md
└── README.md
```

---

## 八、Phase 规划

### Phase 1 — 简单 RAG Loop ✅ 已完成

| 组件 | 状态 |
|------|------|
| RAG 核心（ingest / retrieve / query）| ✅ |
| SQLite 元数据存储 | ✅ |
| ChromaDB 向量存储 | ✅ |
| REST API（KB / Bot / Doc / Chat）| ✅ |
| 多轮对话 Session | ✅ |
| Web UI（Chat / KB / Bot / Settings）| ✅ |
| Vault（Local + WebDAV + 自动同步）| ✅ |
| 运行时设置覆盖 | ✅ |
| 会话删除 | ✅ |

### Phase 2 — AI Agent（待规划）

| 组件 | 说明 |
|------|------|
| OpenAI Agents SDK | Agent 通过 ReAct Loop 决定搜什么、搜几次 |
| Tool 层 | `search_kb`、`list_kbs` 包装成 Agent Tool |
| 多 KB 策略 | Agent 按需决定搜哪些 KB |
| Reranker | 根据召回质量评估 |
| Guardrails | 输入/输出过滤 |

迁移路径：`core/`、`storage/`、`vault/` 不变，SDK 只替换 `server/routes/chat.py` 中的编排层。

---

## 九、未定项

- [ ] **Phase 2 Agent 工具设计**：`search_kb` 参数形式、是否需要 `list_kbs`、`summarize_results`
- [ ] **部署方式**：Docker 容器化（与 NAS 现有服务保持一致）
- [ ] **PDF / DOCX 支持**：PyMuPDF / python-docx，需评估依赖体积
- [ ] **Embedding 缓存**：避免重复向量化同一文本
- [ ] **多用户 / 权限隔离**：当前无认证，单用户本地使用场景
