# Memoria 架构与系统上下文 (System Context)

本文档是 Memoria 系统的整体业务模型、技术架构、核心概念与演进决策全景，旨在为后续维护、协作开发以及 AI Agent 深入理解代码与领域提供单一真实事实来源（Single Source of Truth）。

---

## 1. 系统定位与核心愿景

**Memoria** 是一个基于 **`@earendil-works/pi-durable` 与单文件 `node:sqlite`** 构建的全栈 TypeScript **本地优先个人知识库与受控运维 AI Agent 平台**。它结合了：
- **单文件 SQLite 混合检索 RAG（向量 + FTS5 BM25）与本地目录 / WebDAV Vault 自动同步**：构建零外部依赖的个人长短期外脑。
- **持久化状态机 Agent 引擎（`pi-durable` Harness）**：支持多模型渠道切换、思考深度（Thinking Level）控制、会话级作用域开关（按需挂载知识库与主机）、运行中实时插话（`steer`）、自动上下文压缩（Compaction）与按需派生隔离的子智能体任务（Subagent）。
- **安全受控的主机运维与基础设施连接器（Host Connector & Remote Execution）**：基于 `ssh2` 连接池与 HTTP CONNECT / SOCKS5 代理隧道，在 `CommandGuard` 三级安全模式与持久化审批挂起流约束下，实现对受控服务器的故障诊断与命令执行。
- **统一双向交互接入层**：
  - **Web SPA**：React 19 + Tailwind 控制台，基于 `pi-durable` 原生快照+增量流（`watchEvents`）实现断线/刷新无缝重连、折叠思考、流式工具与子会话追踪。
  - **OpenAI 兼容 API** (`/v1/chat/completions`)：供第三方客户端接入统一 Agent 能力。
  - **QQ 官方 Bot 通道**：基于官方 WebSocket 网关的 C2C 与群聊接入，具备限流熔断、群聊审批与 Markdown 渲染能力。

---

## 2. 领域术语表 (Ubiquitous Language)

| 术语 | 英文 / 标识 | 业务定义与系统角色 |
| :--- | :--- | :--- |
| **持久化智能体运行时** | `Harness` (`pi-durable`) | 管理所有会话、模型生成、工具调用任务与状态文档的事务性内核，所有状态变更先落盘 SQLite 再向外广播。 |
| **会话** | `Conversation` | 唯一的对话与任务上下文容器（彻底统一原 `bot` 与 `agentic` 会话），包含不可变消息记录（`Entry`）与关联状态文档（`Document`）。 |
| **会话作用域** | `ConversationScope` (`memoria.scope`) | 会话级持久化配置文档，决定当前会话勾选启用的知识库集合（`kbIds`）、受控主机集合（`hostIds`）、主机安全模式覆盖以及联网搜索开关（`webSearch`）。 |
| **模型与思考配置** | `AgentConfig` (`pi.agent`) | 会话级模型选择（Provider + Model ID）、思考深度（`thinkingLevel`: `off`/`low`/`medium`/`high`）与启用扩展列表。 |
| **领域扩展** | `Extension` | `pi-durable` 的能力模块化单元（包括 `KnowledgeExtension`、`HostExtension`、`WebExtension`、`SubagentExtension`），封装工具、动态系统提示词切片（`Section`）与拦截钩子（`Hook`）。 |
| **子智能体委派** | `Subagent` (`delegate_subagent`) | 由当前工具调用任务拥有的隔离子会话（Task-owned Child Conversation），用于处理多步排障或重度检索，仅将最终结论回传主会话。 |
| **实时操控与追问** | `Steer` / `FollowUp` | 会话运行中提交的指令：`steer` 在当前工具轮次结束后立即插入并修正运行方向；`followUp` 在本轮回答完成后自动启动下一轮。 |
| **知识库** | `KnowledgeBase` (`kb`) | 文档逻辑集合，支持 `upload`（手动上传 `.md`/`.txt`/`.pdf`/`.docx`）或 `vault`（绑定外部目录/WebDAV 自动同步）。 |
| **知识库保险库** | `Vault` | 外部存储源绑定实体（Local 目录或 WebDAV），支持定时 SHA-256 增量扫描与自动重索引。 |
| **文档与分块** | `Document` / `Chunk` | 知识库中的具体文件与切分片段，在 SQLite 中同时存储 `Float32Array` 向量 BLOB 与 `FTS5` 中文分词全文索引。 |
| **受控主机** | `Host` | 通过 SSH 接入的受控计算节点，支持默认工作目录（`default_cwd`）与代理隧道穿透。 |
| **主机代理连接** | `HostProxy` (`proxy_url`) | 为受管主机建立的出口隧道，支持 `http://`、`https://`、`socks5://`、`socks5h://`（默认远程 DNS 解析），凭据经 AES-256-GCM 加密存储并脱敏回显。 |
| **主机安全模式** | `SecurityMode` | 主机安全等级：`read_only`（仅白名单只读）、`ask_confirmation`（交互审批挂起）、`unrestricted`（非高危黑名单直接执行）。 |
| **安全审批流** | `ApprovalFlow` | 命中需确认指令时，工具任务通过 `api.details()` 发布待审批单并挂起等待，由管理员在 Web 或 QQ 会话中批准或拒绝后恢复执行。 |
| **模型渠道** | `ModelProvider` | 在系统设置中配置的 LLM 对话厂商端点（OpenAI 兼容 / Anthropic / Gemini）、协议类型、API 密钥与模型列表，所有渠道在系统中平等治理，并支持在线可视化编辑。 |
| **向量嵌入引擎** | `EmbeddingEngine` | 专供知识库 RAG 的向量化基座配置（`embedding_base_url`, `embedding_api_key`, `embedding_model`），与对话渠道正交解耦，可独立指向本地 Ollama 或外部嵌入服务。 |
| **外部鉴权凭据** | `ExternalApiSecurity` | 供外部第三方客户端（如 NextChat、沉浸式翻译、Raycast）通过 Bearer Token 访问本系统 API 的访问凭据（`external_api_token`）。 |
| **笔记库调度器** | `VaultScheduler` | 位于知识库模块的后台轮询调度器，按全局同步周期自动串行扫描开启了 `auto_sync` 的 Vault 仓库并执行增量 RAG 摄取。 |
| **QQ 通道网关** | `QQGateway` | 基于腾讯开放平台官方 WebSocket 协议的异步消息网关，负责心跳、重连、白名单策略与命令审批交互。 |

---

## 3. 架构分层与核心模块

```
┌────────────────────────────────────────────────────────────────────────┐
│                        外部接入层 (Ingress)                             │
│  React 19 SPA (Vite)  │  OpenAI API (/v1/chat)  │  QQ Bot Gateway (WSS)│
└───────────────────┬───────────────────┬───────────────────┬────────────┘
                    │                   │                   │
┌───────────────────▼───────────────────▼───────────────────▼────────────┐
│                   TypeScript 服务端路由与流适配层                       │
│  /api/conversations (watchEvents SSE · submit · steer · abort · scope) │
│  /api/knowledge-bases · /api/hosts · /api/settings · /api/logs · /v1   │
└───────────────────┬───────────────────────────────────────┬────────────┘
                    │                                       │
┌───────────────────▼───────────────────────────────────────▼────────────┐
│                 业务与智能体核心引擎 (Node.js >= 22.19)                 │
│  ┌─────────────────────────────────┐  ┌─────────────────────────────┐  │
│  │  pi-durable Harness & Extensions│  │  SQLite Hybrid RAG Engine   │  │
│  │  - Conversation & Scope Docs    │  │  - unpdf / mammoth / Chunker│  │
│  │  - KB / Host / Web Extensions   │  │  - Float32 Vector Cosine    │  │
│  │  - Task-owned Subagent Tool     │  │  - SQLite FTS5 + Segmenter  │  │
│  │  - Auto Compaction & Truncation │  │  - RRF Hybrid Fusion        │  │
│  └────────────────┬────────────────┘  └──────────────┬──────────────┘  │
│                   │                                  │                 │
│  ┌────────────────▼────────────────┐  ┌──────────────▼──────────────┐  │
│  │  SSH Host Connector (ssh2)      │  │  Vault Syncer               │  │
│  │  - Connection Pool & Proxy      │  │  - Local / WebDAV Scanner   │  │
│  │  - CommandGuard & Approval Flow │  │  - SHA-256 Incremental Sync │  │
│  └─────────────────────────────────┘  └─────────────────────────────┘  │
└───────────────────────────────────────┬────────────────────────────────┘
                                        │
┌───────────────────────────────────────▼────────────────────────────────┐
│                    单文件持久化层 (node:sqlite WAL)                     │
│  memoria.db:                                                           │
│  - pi-durable 事务表 (conversations, entries, tasks, docs, usage)      │
│  - 业务与检索表 (kbs, docs, chunks, chunks_fts, vaults, hosts, logs)   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 4. 关键架构决策记录 (ADR 索引)

- **[ADR-0003](adr/0003-agent-tool-matrix-and-web-agent.md)**: 确立知识库（`kb_search`/`kb_read`）、受控主机（`host_exec`/`host_read_log`）与联网搜索（`web_search`/`web_fetch` + Local-First 开关）三大核心工具集。
- **[ADR-0004](adr/0004-agent-configuration-modularization.md)**: 系统设置采用水平分段 Tab、URL 深链接、Keep-Alive 保活挂载与差量提交（Differential Payloads）。
- **[ADR-0005](adr/0005-deep-host-execution-and-pipeline-pruning.md)**: 主机命令安全校验（`CommandGuard`）、审批生命周期与一次性授权下沉为内聚深模块。
- **[ADR-0006](adr/0006-host-proxy-tunneling.md)**: 受控主机支持 `proxy_url`（HTTP CONNECT 与 SOCKS5 远程 DNS 解析）、凭据强加密与分层连通性诊断。
- **[ADR-0007](adr/0007-pi-durable-typescript-rewrite.md)**: 全面重构为基于 `@earendil-works/pi-durable@1.1.0` 与单文件 `node:sqlite` 的全栈 TypeScript 架构；砍掉冗余 `Chat`/`Bots` 模块，统一为单主 Agent + 会话级作用域开关 + 按需 Subagent；向量与 BM25 检索收敛至单文件 SQLite（`Float32Array` BLOB + `FTS5`）。
- **[ADR-0008](adr/0008-settings-orthogonality-and-provider-unification.md)** *(最新配置治理)*: 系统全局设置职责正交化（拆分独立向量嵌入、对话渠道与外部鉴权凭据）；多模型渠道平等化与在线编辑能力；Vault 笔记库同步管理收敛至知识库页面并补齐后台串行定时轮询器。
