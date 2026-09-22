# Memoria 架构与系统上下文 (System Context)

本文档是 Memoria 系统的整体业务模型、技术架构、核心概念与演进决策全景，旨在为后续维护、协作开发以及 AI Agent 深入理解代码与领域提供单一真实事实来源（Single Source of Truth）。

---

## 1. 系统定位与核心愿景

**Memoria** 是一个面向个人与专业场景的**轻量级本地优先 / 混合云 Multi-Agent 与知识助手平台**。它结合了：
- **多知识库 RAG（检索增强生成）与 Obsidian / WebDAV 实时双向/单向同步**：构建个人长短期外脑。
- **动态 Multi-Agent 编排体系（Orchestrator-Workers & Agent-as-a-Tool）**：基于 OpenAI Agent SDK 协议与 ReAct 循环，编排专家 Agent 协作。
- **安全受控的主机运维与基础设施连接器（Host Connector & Remote Execution）**：在受严格安全模式与审批流约束下，实现对受控服务器的故障诊断、命令执行与状态感知。
- **统一双向交互接入层**：
  - **Web SPA**：现代化 React + Tailwind 控制台，支持折叠思考（Thinking Box）、流式 Span 追踪可观测性。
  - **OpenAI 兼容 API** (`/v1/chat/completions` 与 `/v1/responses`)：支持沉浸式工具调用、Sub-agent 追踪暴露与 Token 鉴权。
  - **QQ 官方 Bot 通道**：基于官方 WebSocket 网关的 C2C 与群聊接入，具备限流熔断、群聊审批与 Markdown 渲染能力。

---

## 2. 领域术语表 (Ubiquitous Language)

| 术语 | 英文 / 标识 | 业务定义与系统角色 |
| :--- | :--- | :--- |
| **知识库** | `KnowledgeBase` (`kb`) | 文档逻辑集合，关联向量库 Collection，支持手动上传或绑定远程 Vault。 |
| **知识库保险库** | `Vault` | 外部存储源绑定实体（Local 目录或 WebDAV），支持定时增量哈希扫描与双向同步。 |
| **文档** | `Document` (`doc`) | 知识库中的具体文件实体，拆分为多个 Chunk 并存储向量表示。 |
| **分块** | `Chunk` | 文本切分片段，携带元数据并生成 Embedding 向量存入 Chroma。 |
| **机器人 / 业务智能体** | `Bot` | 业务形态配置，绑定系统提示词、特定模型、专属知识库集合及受控主机列表。 |
| **外部模型标识** | `model_key` | 外部调用暴露的唯一模型别名，全局唯一（如 `my-assistant`），也可用于 OpenAI 协议调用。 |
| **会话** | `Session` | 状态与历史上下文容器，细分为基础 Bot 会话 (`bot`) 与 Agentic 对话 (`agentic`)。 |
| **消息** | `Message` | 会话中的交互单元（user/assistant/system），支持状态跟踪与引文引用。 |
| **追踪与跨度** | `Trace` / `Span` | Agent 执行调用链与耗时度量，记录子智能体委托、工具调用、思考过程与 Token 消耗。 |
| **编排智能体** | `Orchestrator` | Agent 系统中枢，负责意图理解、全局任务分解、动态委派下发与跨专业结果汇聚。 |
| **专家子智能体** | `Sub-agent` (`Worker`) | 专注单一领域的专家（如 `kb_agent` 知识检索专家、`host_agent` 主机运维专家）。 |
| **智能体即工具** | `Agent-as-a-Tool` | 将子 Agent 包装为标准函数工具（Function Tool），由主编排者按需通过函数调用进行委托。 |
| **受控主机** | `Host` | 通过 SSH 接入的受控计算节点，受安全策略模式严密管控。 |
| **主机安全模式** | `SecurityMode` | 主机安全等级：`read_only`（仅读）、`ask_confirmation`（交互审批）、`unrestricted`（免审批）。 |
| **安全审批流** | `Approval Flow` | 高危或非读操作时触发的挂起-决策机制，支持通过 Web 或 QQ 机器人交互确认。 |
| **QQ 通道网关** | `QQ Gateway` | 基于腾讯开放平台官方 WebSocket 协议的异步消息网关，负责心跳、重连与鉴权。 |

---

## 3. 架构分层与核心模块

```
┌────────────────────────────────────────────────────────────────────────┐
│                        外部接入层 (Ingress)                             │
│  React 19 SPA (Vite)  │  OpenAI 兼容 API (/v1)  │  QQ Bot Gateway (WSS)│
└───────────────────┬───────────────────┬───────────────────┬────────────┘
                    │                   │                   │
┌───────────────────▼───────────────────▼───────────────────▼────────────┐
│                        服务端路由与控制层 (API Gateway)                  │
│  FastAPI Routes: /api/bots, /api/knowledge-bases, /api/hosts, /v1/...  │
│  Token 认证鉴权 · 请求日志审计 · 统一异常转换与 CORS 控制                │
└───────────────────┬───────────────────┬───────────────────┬────────────┘
                    │                   │                   │
┌───────────────────▼───────────────────▼───────────────────▼────────────┐
│                        业务与智能体核心引擎 (Core Engines)              │
│  ┌─────────────────────────┐  ┌─────────────────────────────────────┐  │
│  │   AgentEngine (Orch)    │  │        RAG Pipeline                 │  │
│  │  - Orchestrator         │  │  - Smart Chunker                    │  │
│  │  - Sub-Agents (KB/Host) │  │  - OpenAI / Ollama Embedder         │  │
│  │  - Agent Tools & Spans  │  │  - Chroma Vector Search             │  │
│  └────────────┬────────────┘  └──────────────────┬──────────────────┘  │
│               │                                  │                     │
│  ┌────────────▼────────────┐  ┌──────────────────▼──────────────────┐  │
│  │   Host Connector Engine │  │        Vault Syncer (Scheduler)     │  │
│  │  - SSH Pool & Execution │  │  - Local / WebDAV Incremental Sync  │  │
│  │  - Security & Approval  │  │  - SHA256 Diff & Auto Re-index      │  │
│  └─────────────────────────┘  └─────────────────────────────────────┘  │
└───────────────────┬───────────────────────────────────────┬────────────┘
                    │                                       │
┌───────────────────▼───────────────────────────────────────▼────────────┐
│                        数据持久化层 (Storage Layer)                      │
│      SQLite (SQLAlchemy): 元数据、会话、审计日志、设置、加密凭据         │
│      ChromaDB: 知识库文本向量持久化                                    │
└────────────────────────────────────────────────────────────────────────┘
```

### 3.1 `memoria/agents/` (Multi-Agent 体系与统一单轮编排)
- **`engine.py`**: 定义统一单轮会话编排器 `AgentEngine`（向前兼容 `AgenticRagEngine`）。主编排器 `Orchestrator` 协调多智能体图与工具执行回路，动态挂载 `kb_agent`（检索增强专家）、`host_agent`（主机管理专家）及 `web_agent`（互联网搜索专家）为委托工具。CLI、QQBot、OpenAI 兼容协议均汇聚于此统一执行，支持思考流（`response.thought.delta`）与 Span 级追踪。
- **`tools.py`**: 聚合底层各专家专业操作（`AgentKnowledgeTools`、`AgentHostTools`、`AgentWebTools`），提供各专家专员工具集合与元数据。
- **`state.py`**: 运行时引用来源收集器 `SourceCollector`，负责归集、去重与打分知识库文本片段及 Web 搜索引用。

### 3.2 `memoria/core/` (RAG 底层检索与摄取流水线)
- **`chunker.py`**: 语义与结构敏感的 Markdown / Text 分块器，保留代码块与标题层级完整性。
- **`embedder.py`**: 统一 Embedding 抽象，适配 OpenAI 兼容端点、本地 Ollama 等向量模型。
- **`pipeline.py`**: 纯粹底层 RAG 摄取与混合检索引擎（Retrieval Engine）。负责文档切分、向量嵌入、ChromaDB 持久化与 BM25 稀疏检索融合，不承载任何会话生成逻辑。

### 3.3 `memoria/connectors/` (基础设施连接器)
- **`host/connector.py`**: 基于 Paramiko 的 SSH 连接池管理。具备会话保活、命令超时熔断与输出缓冲。
- **`host/security.py`**: 主机安全防护核心。定义敏感命令白名单/黑名单校验，严格执行 `read_only`、`ask_confirmation`、`unrestricted` 三种安全模式。
- **`crypto.py`**: 基于 AES-GCM / Fernet 对存入数据库的主机 SSH 私钥、密码及 WebDAV 凭据进行本地可逆强加密。

### 3.4 `memoria/vault/` (外部知识库同步)
- **`syncer.py`**: 后台定时任务（基于 APScheduler），定期扫描 Local 目录或 WebDAV 远端。通过文件哈希（SHA-256）与修改时间识别新增、修改与删除文件，自动增量更新 Chroma 向量与 SQLite 记录。
- **`connector.py`**: 统一的文件系统/WebDAV 访问协议适配层。

### 3.5 `memoria/qqbot/` (QQ 官方机器人接入通道)
- **`gateway.py`**: 官方 WebSocket Gateway 客户端，实现 Heartbeat、Resume、鉴权认证以及网关主动重连；内置网关限流器（RateLimiter）防止被腾讯平台封禁。
- **`adapter.py`**: 消息分发引擎。将用户 C2C / 群聊消息转换为标准会话输入，调度 Agent 生成回答并异步推回 QQ 平台；具备用户 OpenID/群聊白名单过滤策略。
- **`formatting.py`**: 针对 QQ 限制进行消息切片、Markdown 样式适配与安全转义。

### 3.6 `memoria/server/` & `web/` (接口与展示层)
- **`routes/openai.py`**: 提供标准 OpenAI 协议（`/v1/models`, `/v1/chat/completions`, `/v1/responses`）。支持 `X-Memoria-Client: web` 下的全量 Span 结构输出，其他外部调用则平滑输出聚合文本与思考标签。
- **`routes/logs.py`**: 提供调用审计日志（API Invocations）与系统运行日志（System Logs）的聚合查询与分页过滤。
- **`web/`**: 基于 React 19 + Tailwind CSS + Lucide Icons 构建的纯 SPA 前端，已构建并托管在后端 `memoria/static/`。

---

## 4. 关键设计决策与约定 (ADR 摘要)

### ADR-1: 本地优先与单机元数据存储
- **决策**: 元数据持久化采用 SQLite（通过 SQLAlchemy ORM 统一管理），向量数据采用本地持久化的 ChromaDB。
- **理由**: 确保极简单机部署（单 Docker 或单 Python 虚拟环境即可运行），无需搭建复杂的 MySQL / PostgreSQL / Redis 依赖。

### ADR-2: Multi-Agent 架构采用 Agent-as-a-Tool (委托模式)
- **决策**: 不采用复杂的有向无环图（DAG）硬编码编排，而是由主智能体（Orchestrator）作为根大脑，将子能力封装为 Function Tools（如 `delegate_to_kb_agent`、`delegate_to_host_agent`）。
- **理由**: 灵活性极高，大模型能够根据用户自然语言意图动态决策是一次性检索知识库、直接查询主机状态，还是先查主机再查排障知识库。

### ADR-3: 主机远程执行的严格确认与审批流设计
- **决策**: 主机连接器默认启用安全隔离模式（`read_only` 或 `ask_confirmation`）。当 Agent 判断需要执行非只读或危险命令时，系统将阻断执行，生成 `approval_id` 并挂起，等待 Web 控制台或管理员在 QQ 对话中显式批准。
- **理由**: 彻底消除大模型在受控主机上发生“幻觉破坏”或执行不可逆高危脚本的致命风险。

### ADR-4: 双轨制 OpenAI 协议与思考/追踪兼容
- **决策**: Web 端和第三方客户端统一收敛到 `/v1/chat/completions` 与 `/v1/responses`。通过请求头（`X-Memoria-Client: web`）区分：Web 端接收细粒度 Agent Trace Span（用于可视化展示调用链与耗时）；标准 OpenAI 客户端则接收流式思考标记（`<thought>...</thought>`）或折叠思考块，无缝兼容 Cherry Studio、Chatbox 等第三方客户端。

### ADR-5: 统一单轮会话编排器 (Unified Turn Orchestrator)
- **决策**: 将 `AgenticRagEngine` 增强并更名为 `AgentEngine`（保留向前兼容别名），确立为唯一的单轮执行编排器。收敛 CLI `query`、QQ 机器人适配器和 OpenAI 路由至统一流式/非流式编排内核。彻底清理未注册或废弃的 `routes/chat.py` 与 `routes/agent_chat.py`。底层 `Pipeline` 退回纯粹的 RAG 检索增强引擎。

### ADR-6: 专家智能体配置与全局系统设置模块化解耦
- **决策**: 将原本平铺堆叠的单体设置长页面解耦为「全局基础底座」与各专家专员（`KnowledgeAgent`、`HostAgent`、`WebAgent`）及通道网关（`QQBot`）的独立模块切片。采用水平分段 Tab 与 URL 深链接（`/settings`、`/settings/:tab`）双向同步，配合保活挂载（Keep-Alive）与差量提交（Differential Payloads），彻底隔离各切片表单生命周期与未提交草稿，消除多模块干扰与意外覆盖。
- **理由**: 与系统 Multi-Agent 架构严格对齐，降低配置认知负荷，保证交互与草稿安全，提供直达深链接支持。

### ADR-7: 深模块主机执行收敛与底层检索流水线纯粹化
- **决策**: 将高危命令校验（`CommandGuard`）、审批生命周期（`HostApprovalManager`）、一次性授权与 SSH 执行全面下沉收敛为深模块 `Host Execution`，主编排器通过单点回调接缝交互，消除跨模块 Token 泄露与三度重复校验；彻底剔除 `Pipeline` 中遗留的 360 行僵尸对话回路（`query()`、`prepare_query()` 及主机工具），使其回归纯粹的向量摄取与混合检索基础设施。
- **理由**: 消除代码库中双重对话回路的认知分裂，最大化主机安全治理与审批流的局部性（Locality），通过删除测试显著降低维护与测试摩擦。

---

## 5. 项目工程规范与技术约束

1. **提交规范**: `type: 中文摘要`（例如 `feat: 支持Hermes风格Token流式输出`、`fix: 处理模型不可用时的错误响应`）。
2. **测试与质量**: 核心业务与 Agent 行为必须有对应的单元测试或模拟测试（位于 `tests/`）。
3. **安全第一**: 凭据（SSH 密钥、WebDAV 密码等）禁止明文入库；所有主机操作遵从安全检查器。
4. **统一配置**: 统一使用 `memoria.config.settings`，并支持动态存储在 SQLite `settings` 表中覆盖。
