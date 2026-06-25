# Memoria — 技术设计文档

> Bot 管理平台 + Agentic RAG 引擎
> 作者：kougami
> 状态：草稿 / 待实现

---

## 零、设计原则

1. **长时运行的服务是主模式** — `memoria serve` 启动，对外暴露 REST API。其他交互方式（QQ Bot、Web UI、CLI）统一通过 API 调用引擎
2. **CLI 仅为调试工具** — 开发阶段方便手动测试，不承载核心交互
3. **可集成第一** — 现有系统只需调 HTTP 接口即可接入 Bot 能力，符合企业实际场景
4. **引擎与交互层完全解耦** — RAG 引擎是独立的 Python 库，服务 / CLI / 其他适配器都导入它
5. **Bot 是核心抽象** — 每个 Bot 是一个独立 AI 助手，可关联多个知识库，对外暴露统一对话入口
6. **渐进式演进** — Phase 1 手写简单 RAG Loop 跑通全流程，Phase 2 引入 Agent SDK 升级为 Agentic RAG。不在一开始引入框架复杂度

---

## 一、核心概念与术语

| 术语 | 定义 |
|------|------|
| **Document** | 原始文件（.md / .txt / .pdf / .docx），用户导入的源材料 |
| **Chunk** | 文档切分后的文本片段，是向量化和检索的基本单元 |
| **Embedding** | Chunk 经模型转换后的浮点数向量 |
| **Knowledge Base** | 一个 Chroma collection，包含一批文档的向量索引。独立管理，独立检索 |
| **Bot** | 对外暴露的 AI 助手。关联 N 个 Knowledge Base，拥有独立的 System Prompt 和模型配置 |
| **Query** | 用户输入的提问文本 |
| **Context** | Retrieve 阶段召回的相关 Chunks，拼入 Prompt |
| **Session** | 单轮或多轮对话上下文（涉及后续 Agentic 扩展） |

### 实体关系

```
Document (N) ──belongs to──> (1) Knowledge Base
Bot (N) <──associates──> (M) Knowledge Base  (多对多)
Bot (1) ──has──> (N) Session
```

每个 Bot 对外暴露唯一的 `/api/chat/{bot_id}` 端点。

---

## 二、系统架构概览

```
┌───────────────────────────────────────────────────────────────┐
│                        调用方                                 │
│  (管理后台 Web / QQ Bot / 现有系统 / curl / 任何 HTTP 客户端)   │
└──────────────────────┬────────────────────────────────────────┘
                       │ HTTP (REST API)
                       ▼
┌───────────────────────────────────────────────────────────────┐
│                    Memoria Service (FastAPI)                   │
│                                                                │
│  ┌─ 管理 API ───────────────────────┐  ┌─ 对话 API ────────┐  │
│  │  POST   /api/knowledge-bases     │  │                   │  │
│  │  GET    /api/knowledge-bases     │  │  POST             │  │
│  │  GET    /api/knowledge-bases/:id │  │  /api/chat/{bot}  │  │
│  │  DELETE /api/knowledge-bases/:id │  │                   │  │
│  │                                  │  │                   │  │
│  │  POST   /api/bots                │  │                   │  │
│  │  GET    /api/bots                │  │                   │  │
│  │  GET    /api/bots/:id            │  │                   │  │
│  │  PUT    /api/bots/:id            │  │                   │  │
│  │  DELETE /api/bots/:id            │  │                   │  │
│  │                                  │  │                   │  │
│  │  POST   /api/knowledge-bases/:id │  │                   │  │
│  │         /documents               │  │                   │  │
│  │  GET    /api/documents           │  │                   │  │
│  │  DELETE /api/documents/:id       │  │                   │  │
│  └──────────────────────────────────┘  └───────────────────┘  │
│                                                                │
│  ┌────────────────────────────────────────────────────────┐    │
│  │               memoria 核心库 (Python Package)           │    │
│  │  core/pipeline.py  ← ingest / retrieve / query 编排    │    │
│  │  core/chunker.py   ← 文本切分                          │    │
│  │  core/embedder.py  ← embedding 调用                    │    │
│  │  storage/          ← Chroma collection 操作            │    │
│  │  llm/caller.py     ← LLM 调用                          │    │
│  └────────────────────────────────────────────────────────┘    │
└──────────────────────┬────────────────────────────────────────┘
                       │
          ┌────────────┴────────────┐
          ▼                         ▼
┌──────────────────┐     ┌──────────────────────┐
│  SQLite (元数据)  │     │  Chroma (向量)        │
│                  │     │                      │
│  bots            │     │  kb_<id>             │
│  knowledge_bases │     │  kb_<id>             │
│  bot_kb_links    │     │  kb_<id> (独立col.)  │
│  documents_meta  │     │                      │
│  sessions        │     │                      │
└──────────────────┘     └──────────────────────┘
```

### 双存储说明

| 存储 | 存什么 | 原因 |
|------|--------|------|
| **SQLite** | Bot 配置、知识库元数据、文档元数据、对话历史 | Python 自带，零依赖，量小（几千条记录） |
| **Chroma** | 文档 chunk 的向量索引 | 专门做 ANN 检索，每个 KB 一个 collection |

---

## 三、接口契约

### 3.1 RAG 引擎（Python API）— 供测试和内部调用

> 这是最底层接口，**测试围绕它写**。服务层和 CLI 都调它。

```python
def ingest(kb_id: str, path: str | list[str]) -> IngestResult
    """加载文件 → chunk → embedding → 写入指定的 knowledge base。"""

def retrieve(kb_id: str, query: str, k: int = 5) -> list[ChunkResult]
    """在指定 knowledge base 中检索，返回 top-k 文本片段及相似度分数。"""

def query(bot_id: str, query: str, stream: bool = False) -> QueryResult
    """按 Bot 关联的所有 KB 检索 → 合并结果 → 拼 Prompt → LLM 回答。"""

def list_docs(kb_id: str) -> list[DocInfo]
    """列出指定知识库中的文档。"""

def delete_doc(kb_id: str, doc_id: str) -> bool
    """删除指定知识库中的文档及其所有 chunk。"""
```

### 3.2 REST API（服务层）

#### 知识库管理

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/knowledge-bases` | 创建知识库：`{"name": "简历", "description": "..."}` |
| `GET` | `/api/knowledge-bases` | 列出所有知识库 |
| `GET` | `/api/knowledge-bases/{kb_id}` | 知识库详情（含文档列表） |
| `DELETE` | `/api/knowledge-bases/{kb_id}` | 删除知识库及其所有向量 |

#### Bot 管理

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/bots` | 创建 Bot：`{"name": "面试助手", "system_prompt": "...", "kb_ids": ["kb_1", "kb_2"]}` |
| `GET` | `/api/bots` | 列出所有 Bot |
| `GET` | `/api/bots/{bot_id}` | Bot 详情（含关联的知识库） |
| `PUT` | `/api/bots/{bot_id}` | 更新 Bot 配置（prompt、关联 KB 等） |
| `DELETE` | `/api/bots/{bot_id}` | 删除 Bot |

#### 文档管理

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/knowledge-bases/{kb_id}/documents` | 上传文档入库（multipart） |
| `GET` | `/api/documents` | 文档列表（可加 `?kb_id=` 过滤） |
| `DELETE` | `/api/documents/{doc_id}` | 删除文档及其向量 |

#### 对话

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/chat/{bot_id}` | 对话入口：`{"message": "你好"}`（可传 `session_id` 续聊） |
| `GET` | `/api/health` | 健康检查 |

### 3.3 CLI（调试工具）— 开发阶段手动测试用

```
memoria serve              ← 启动长时服务（主模式）
memoria kb create <name>   ← 创建知识库
memoria kb list            ← 列出知识库
memoria bot create <name>  ← 创建 Bot
memoria bot list           ← 列出 Bot
memoria ingest <kb_id> <path>  ← 入库文档
memoria query <bot_id> "<问题>" ← 对话
memoria list               ← 文档列表
memoria config show        ← 查看配置
memoria config set k=v     ← 修改配置
```

### 3.4 QQ Bot / Web UI — 通过 HTTP 调用服务

都是 Memoria Service 的 HTTP 客户端。

- **QQ Bot**：监听消息 → `POST /api/chat/{bot_id}` → 回复
- **Web UI**：「管理后台」调管理 API，「对话界面」调 `/api/chat/`

---

## 四、数据流

### 对话流程

```
POST /api/chat/{bot_id} {"message": "什么是RAG"}
      │
 ├─────┴────────────────────────────────────┐
 │  ① 查 SQLite → 获取 Bot 配置             │
 │    - system_prompt                       │
 │    - 关联的 kb_ids: ["kb_1", "kb_2"]     │
 │    - 模型配置（可选覆盖全局）              │
 ├─────────────────────────────────────────┤
 │  ② 并行检索所有关联 KB                    │
 │    retrieve("kb_1", query, top_k)        │
 │    retrieve("kb_2", query, top_k)        │
 │    各取 top-k，合并后 rerank 取最终 top-k   │
 ├─────────────────────────────────────────┤
 │  ③ 拼 Prompt                             │
 │    System Prompt + 检索结果 + 用户消息     │
 ├─────────────────────────────────────────┤
 │  ④ 调 LLM → 返回回答 + 来源              │
 └─────────────────────────────────────────┘
```

### 入库流程

```
POST /api/knowledge-bases/{kb_id}/documents (上传文件)
      │
 ├────┴────────────────────────────────────┐
 │  ① 存原始文件到 data/uploads/           │
 │  ② 记录文档元数据到 SQLite              │
 │  ③ Chunk（RecursiveCharacterTextSplitter）│
 │  ④ Embed（text-embedding-3-large）       │
 │  ⑤ 写入 Chroma collection "kb_{kb_id}" │
 ├─────────────────────────────────────────┤
 │  ⑥ 返回入库结果                          │
 └─────────────────────────────────────────┘
```

### CLI 调试流程

```
memoria query "xxx"
      │
 调 memoria RAG 引擎 Python API（直连，不走 HTTP）
      │
 结果打印到终端
```

---

### Phase 2 Agentic RAG 流程（未来扩展）

```
POST /api/chat/{bot_id} {"message": "帮我比较一下RAG和微调"}
      │
 ├─────┴──────────────────────────────────────────────┐
 │  ① 查 SQLite → 获取 Bot 配置 + 关联 KB          │
 ├───────────────────────────────────────────────────┤
 │  ② Agent 开始 ReAct Loop                          │
 │                                                    │
 │  ┌─── ReAct 循环 ────────────────────────────┐    │
 │  │  LLM: "用户要比较RAG和微调，我先搜知识库"   │    │
 │  │  Tool: search_kb("RAG vs 微调对比")        │    │
 │  │  结果: 找到了一些基础概念, 不够全面         │    │
 │  │  LLM: "再换个角度搜一下微调的具体场景"      │    │
 │  │  Tool: search_kb("微调适用场景")           │    │
 │  │  结果: 找到了微调的具体案例                │    │
 │  │  LLM: "信息够了，整理成对比回答"            │    │
 │  │  回答: 结构化的对比结果                     │    │
 │  └────────────────────────────────────────┘    │
 ├───────────────────────────────────────────────────┤
 │  ③ 返回回答 + 引用来源                            │
 └───────────────────────────────────────────────────┘
```

> Phase 2 的核心变化：LLM 不再一次性回答，而是通过 ReAct 循环反复"思考→检索→再思考"，直到信息足够再回答。

```python
# Phase 2 引入 OpenAI Agents SDK 后的代码结构示意
from agents import Agent, Runner, function_tool

@function_tool
def search_kb(kb_id: str, query: str) -> str:
    """在指定知识库中检索相关信息"""
    results = chroma_store.search(kb_id, query, k=5)
    return format_results(results)

agent = Agent(
    name="面试助手",
    instructions="你是一个…",
    tools=[search_kb],  # 你的现有检索逻辑包装成 Tool
)

result = Runner.run_sync(agent, "帮我比较RAG和微调")
```

---

## 五、关键技术决策（ADRs）

### ADR-001：Embedding 模型选型

| 项目 | 内容 |
|------|------|
| 决策 | Phase 1 使用 **text-embedding-3-large**（通过 NewAPI） |
| 选项 | bge-base-zh-v1.5（本地）、all-MiniLM-L6-v2（本地） |
| 理由 | 已有 API 无需部署，1536 维足以覆盖起步需求。后续可切换为本地模型降低延迟/节省 API 费用 |
| 代价 | 每次查询都需 API 调用，离线环境不可用 |
| 可逆性 | ✅ 高度可逆——切换模型只需重跑 ingest，代码改一行配置 |

### ADR-002：向量数据库选型

| 项目 | 内容 |
|------|------|
| 决策 | Phase 1 使用 **Chroma** |
| 选项 | FAISS（纯内存）、Milvus（需服务）、Qdrant（需服务） |
| 理由 | pip install 即用，零配置，支持持久化到本地磁盘，API 简洁 |
| 代价 | 大规模（百万级）性能不如专用向量库，本项目不会到这个量级 |
| 可逆性 | ✅ 存储层已抽象，替换只需实现新的 store adapter |

### ADR-003：Chunking 策略

| 项目 | 内容 |
|------|------|
| 决策 | Phase 1 使用 **RecursiveCharacterTextSplitter** |
| 参数 | chunk_size=512, chunk_overlap=128（初始值，后续调整） |
| 理由 | 成熟稳定，支持按分隔符层级递归切分，语义完整性较好 |
| 代价 | 纯基于字符长度，不理解语义边界 |
| 可逆性 | ✅ chunk 逻辑封装在 pipeline 中，切换策略只需替换 splitter |

### ADR-004：Reranker

| 项目 | 内容 |
|------|------|
| 决策 | **Phase 1 不加入**，Phase 2 评估是否需要 |
| 理由 | MVP 阶段先验证基础召回质量，Reranker 会增加额外延迟和依赖 |
| 可逆性 | ✅ 后续可加入，不影响已有架构 |

### ADR-005：元数据存储选型

| 项目 | 内容 |
|------|------|
| 决策 | Phase 1 使用 **SQLite** 存储 Bot / KB / Document 元数据 |
| 选项 | PostgreSQL（需服务）、JSON 文件（难查询）、SQLAlchemy + 任意 DB |
| 理由 | Python 内置 sqlite3，零依赖零部署。元数据规模极小（Bot < 50, KB < 50, Docs < 5000），SQLite 完全胜任 |
| 代价 | 未来多用户或分布式场景需迁移至 PostgreSQL |
| 可逆性 | ✅ 存储层用 SQLAlchemy 抽象，迁移只需改连接字符串 |

### ADR-006：双存储架构

| 项目 | 内容 |
|------|------|
| 决策 | **SQLite 管元数据，Chroma 管向量**，两者通过 `kb_id` 关联 |
| 理由 | 各司其职——SQLite 适合结构化查询和关系管理（Bot-KB 多对多），Chroma 负责向量相似度搜索。Chroma 不是关系数据库，不适合存元数据 |
| 代价 | 事务一致性需应用层保证（删除 KB 时要同时删 Chroma collection 和 SQLite 记录） |
| 可逆性 | ✅ 不可逆——这是架构层决策。但单 KB 场景下可将 SQLite 视为对 Chroma metadata 的补充 |

### ADR-007：Agent 框架选型

| 项目 | 内容 |
|------|------|
| 决策 | **Phase 1 手写简单 RAG Loop；Phase 2 引入 OpenAI Agents SDK** |
| 选项 | Claude Agent SDK（Python）、LangChain / LangGraph、CrewAI、自研 Agent Loop |
| 理由 | Phase 1 的 RAG 逻辑简单（检索→拼Prompt→回答），不需要框架。Phase 2 需要多步推理、工具调用、Session 管理时，OpenAI Agents SDK 提供完整能力（Agent 定义 / Tool calling / Handoff / Guardrails / Tracing），且 Provider 无关（可继续用 DeepSeek / NewAPI） |
| 代价 | 从手写 Loop 迁移到 SDK 需要重构对话路由；Claude Agent SDK 不适合因为本质是 CLI 包装且绑定 Claude |
| 可逆性 | ✅ 可逆——核心 RAG 库（Chunker / Embedder / Chroma Store）与 Agent 层解耦，Agent SDK 只负责上层编排 |

---

## 六、配置与数据存储

### 6.1 三类资源的分工

| 类别 | 内容 | 管理方式 |
|------|------|----------|
| **代码** | `.py` 文件、pyproject.toml | Git 跟踪 |
| **配置** | API Key、模型名、chunk 参数 | `.env` 文件（Git 忽略）+ 环境变量 |
| **数据** | Chroma 向量库 + SQLite 元数据 + 上传的文档 | `data/` 目录（Git 忽略） |

### 6.2 配置项

```
# .env（不进 Git）
NEWAPI_BASE_URL=https://api.kougami.de/v1
NEWAPI_API_KEY=sk-xxxxx
EMBEDDING_MODEL=text-embedding-3-large
LLM_MODEL=deepseek-v4-flash

# RAG 参数
CHUNK_SIZE=512
CHUNK_OVERLAP=128
TOP_K=5

# 存储路径
DB_PATH=./data/memoria.db       # SQLite 元数据
CHROMA_PATH=./data/chroma       # Chroma 持久化目录
UPLOAD_DIR=./data/uploads       # 原始文档存储
```

提供 `.env.example`（进 Git）作为模板，不含真实密钥。

### 6.3 边界与假设

| 格式 | Phase 1 支持 |
|------|-------------|
| `.md` | ✅ |
| `.txt` | ✅ |
| `.pdf` | ⚠️ 需 PyMuPDF，待评估 |
| `.docx` | ⚠️ 需 python-docx，待评估 |

假设：
1. **中文为主**：chunk separators 包含中文标点
2. **单文档 ≤ 10MB**
3. **总入库量 ≤ 10 万 chunks**（Chroma 在此规模下性能良好）
4. **查询意图**：问答型为主，未覆盖总结型/对比型
5. **MVP 不涉及多轮对话记忆**，每次 query 独立检索

---

## 七、项目结构（初版）

```
memoria/
├── memoria/                          # 核心 Python 包
│   ├── __init__.py
│   ├── core/                         # RAG 引擎
│   │   ├── __init__.py
│   │   ├── pipeline.py               # ingest / retrieve / query 编排
│   │   ├── chunker.py                # 文本切分
│   │   └── embedder.py               # embedding 调用抽象
│   ├── storage/                      # 存储层
│   │   ├── __init__.py
│   │   ├── base.py                   # Chroma 操作抽象
│   │   ├── chroma_store.py           # Chroma 实现（多 collection)
│   │   └── db.py                     # SQLite 元数据存储（Bot/KB/Doc CRUD）
│   ├── models/                       # 数据模型
│   │   ├── __init__.py
│   │   ├── bot.py                    # Bot 模型
│   │   ├── knowledge_base.py         # KB 模型
│   │   └── document.py               # Document 模型
│   ├── llm/
│   │   ├── __init__.py
│   │   └── caller.py                 # LLM 调用包装（NewAPI / OpenAI 兼容）
│   ├── server/                       # FastAPI 服务
│   │   ├── __init__.py
│   │   ├── app.py                    # FastAPI 应用 + 生命周期
│   │   ├── routes/                   # REST 路由模块
│   │   │   ├── __init__.py
│   │   │   ├── knowledge_bases.py    # KB 管理路由
│   │   │   ├── bots.py              # Bot 管理路由
│   │   │   ├── documents.py         # 文档管理路由
│   │   │   └── chat.py              # 对话路由
│   │   └── deps.py                  # 依赖注入（DB session 等）
│   ├── cli/
│   │   ├── __init__.py
│   │   └── main.py                   # CLI 入口（调核心库，不走 HTTP）
│   └── config.py                     # 全局配置（从 .env 读取）
├── tests/
│   ├── test_chunker.py               # 单元测试：切分逻辑
│   ├── test_pipeline.py              # 单元测试：引擎编排
│   ├── test_retrieve.py              # 单元测试：检索
│   ├── test_api.py                   # 集成测试：REST API
│   └── test_models.py               # 单元测试：数据模型
├── data/                             # Git ignored，运行时数据
│   ├── memoria.db                    # SQLite 元数据
│   ├── chroma/                       # Chroma 持久化目录
│   └── uploads/                      # 用户上传的原始文档
├── web/                              # Phase 2 前端（通过 API 调服务）
│   └── (待定)
├── .env                              # Git ignored，敏感配置
├── .env.example                      # Git tracked，配置模板
├── .gitignore
├── DESIGN.md                         # ← 本文档
├── pyproject.toml
└── README.md
```

---

## 八、Phase 规划与演进路线

### Phase 1 — 简单 RAG Loop（当前目标）

| 组件 | 实现方式 |
|------|---------|
| 对话逻辑 | 手写：检索 → 拼 Prompt → LLM 回答（单次，无 Agent Loop） |
| 多 KB 合并 | 各自取 top-k 后合并，取综合得分最高的 N 条 |
| Session | 可选，存对话历史到 SQLite |
| Reranker | 不使用 |

数据流：
```
用户消息 → 搜所有关联 KB → 拼context → LLM回答 → 返回
                          ↑ 一次性，无循环
```

### Phase 2 — Agentic RAG（未来扩展）

| 组件 | 实现方式 |
|------|---------|
| 对话逻辑 | **OpenAI Agents SDK**：Agent 通过 ReAct Loop 决定搜什么、搜几次 |
| 多 KB 合并 | Agent 按需决定搜哪个/哪些 KB，不再是固定全部搜 |
| Tool 层 | 把 `search_kb`、`list_kbs`、`format_results` 等包装成 Agent Tool |
| Session | SDK 内置管理 |
| Reranker | 根据召回质量评估是否加入 |
| Guardrails | 输入/输出过滤（敏感词检测等） |

数据流：
```
用户消息 → Agent 开始 ReAct Loop → 按需搜 KB → 不够再搜 → LLM回答 → 返回
                                    ↑ 可循环多次
```

### 迁移路径

```
Phase 1 代码结构                       Phase 2 代码结构
══════════════════                    ══════════════════
server/routes/chat.py                 server/routes/chat.py
  └─ 直接调 pipeline.query()            └─ 调 Agent Runner
                                          │
pipeline.query()                       agents/agent.py
  ├─ retrieve()                         ├─ Runner.run_sync()
  ├─ 拼 prompt                          ├─ Agent(tools=[...])
  └─ llm.caller()                       └─ tools.py (包装现有函数)
                                            ├─ search_kb()
                                            ├─ list_kbs()
                                            └─ ... 后续扩展
                                        
core/ (不变)                           core/ (不变)
storage/ (不变)                        storage/ (不变)
```

> 核心 RAG 库（chunker / embedder / chroma_store）在 Phase 1 和 Phase 2 之间**不变**，SDK 只加在编排层。这是"底层接口不变，上层换编排"的策略。

## 九、未定项 / 待讨论

- [ ] **Phase 2 Agent Tool 设计**：`search_kb` 的参数设计（单 KB vs 多 KB）、是否加 `list_kbs`、`summarize_results` 等
- [ ] **SQLite schema 设计**：Bot、KB、Document、Bot-KB 关联表的具体字段定义
- [ ] **服务部署方式**：直接运行 vs Docker 容器化（推荐 Docker，方便与现有 NAS 服务一致）
- [ ] **QQ Bot 接入方式**：作为 HTTP 客户端调用 `POST /api/chat/{bot_id}`，需确定 bot_id 怎么映射到 QQ 群/好友
- [ ] **Web UI 技术栈**：管理后台 + 对话面板，选型（Streamlit / Next.js / 纯 HTML+JS）
- [ ] **多 KB 合并检索策略**：各自取 top-k 合并后，需不需要 rerank？合并策略（取交集？并集重排？按 KB 权重？）
- [ ] **Session / 多轮对话**：是否需要在 SQLite 中存对话历史？消息量级评估
- [ ] **是否加入 embedding 缓存**：避免重复向量化同一段文本
- [ ] **服务治理**：日志、健康检查、优雅关闭
- [ ] **测试策略**：单元测试 vs 集成测试的比重
- [ ] **删除 KB 的一致性保障**：同时删 Chroma collection + SQLite 记录，失败怎么回滚
