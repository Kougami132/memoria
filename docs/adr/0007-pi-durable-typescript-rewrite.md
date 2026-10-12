# ADR 0007: 基于 `@earendil-works/pi-durable` 与单文件 `node:sqlite` 的全栈 TypeScript 重构

## Status

Accepted

## Context

在 Memoria Phase 1 至 Phase 2 的演进中，后端基于 Python（FastAPI + `openai-agents==0.0.10` + SQLAlchemy + ChromaDB + `rank-bm25`）构建，前端基于 TypeScript（React 19 + Vite）。随着功能深入，原有自建 Agent 栈暴露出以下结构性瓶颈：

1. **手写流式与状态控制脆弱**：`memoria/agents/engine.py`（1,575 行）与 `memoria/server/routes/openai.py`（790 行）通过内存线程锁 `_ActiveRunRegistry`、手写 AST/JSON 容错解析、手写 `whiteboard.py` 摘要压缩来维持运行态。一旦用户在长耗时巡检中刷新网页、断线重连或中途取消，极易出现状态漂移、流丢失或上下文溢出。
2. **双套对话概念冗余**：系统中并存「常规对话 (`Chat.tsx` + `Bots.tsx` + `session_type="bot"`)」与「AI Agent (`AgenticChat.tsx` + `session_type="agentic"`)」两套 95% 重复的前后端代码，增加了认知与维护负担。
3. **强制子智能体委托（ADR-0001）的延迟与审批割裂**：哪怕仅查询一次知识库或执行一条简单命令，也必须经过 `Orchestrator -> Sub-agent` 两轮模型往返；且 `HostApprovalManager` 基于内存 `asyncio.Event` 阻塞等待，进程重启即丢失审批上下文。
4. **多存储引擎拼装复杂**：同时维护 SQLite（元数据）、ChromaDB（向量）与内存 `jieba` + `BM25Okapi`（每次检索现场分词构建），需要在应用层手动保证跨库级联删除一致性。

与此同时，`@earendil-works/pi-durable@1.1.0` 与 `@earendil-works/pi-ai@1.1.0` 发布，提供了基于 Node.js 内置 `node:sqlite` 的持久化状态机 Agent Harness。

## Decision

> _Supersedes ADR-0001 (Agent-as-a-Tool 强制双层委托), ADR-0002 (Python AgentEngine 单轮编排), and ADR-006 in DESIGN.md (SQLite + Chroma 双存储架构)._

我们决定将 Memoria 后端彻底重构为 **TypeScript（Node.js `>= 22.19.0`）**，与前端 `web/` 统一为全栈 TypeScript 架构：

### 1. 采用 `@earendil-works/pi-durable@1.1.0` 作为核心 Agent 运行时（锁定精确版本）
- 使用 `openNodeSqliteStorage` 将所有会话（`Conversation`）、消息记录（`Entry`）、工具调用任务（`Task`）、运行中流式增量（`pi.live`）、排队消息（`pi.inbox`）与 Token 计费（`pi.usage`）原子化落盘至 SQLite。
- 由于 `pi-durable` 标记为 Experimental，在 `package.json` 中严格锁定 `1.1.0` 精确版本（不使用 `^` 或 `~`）。
- Web 前端直接对接 `pi-durable` 的 `watchEvents()` 快照+增量流，原生支持**断线/刷新重连恢复现场、运行中实时插话纠偏（`steer`）与排队追问（`followUp`）**，废弃 790 行的 `/v1/responses` 双轨制路由。

### 2. 砍掉 `Chat` 与 `Bots` 独立模块，演进为「单主 Agent + 会话级作用域开关（Scope Toggles）」
- 彻底移除旧版 `Chat.tsx`、`Bots.tsx`、`/api/bots` 与 `session_type="bot"` 分支，全局仅保留唯一的 AI Agent 对话工作台。
- 原 `Bot` 绑定特定知识库与主机的能力，转化为每个会话的 `memoria.scope` 持久化文档（`defineDoc`）：用户可在会话中随时勾选/开关当前会话允许挂载的**知识库（`kbIds`）**、**受控主机（`hostIds` 及会话级安全模式覆盖）**与**联网搜索开关（`webSearch`）**。

### 3. 演进工具架构为「主 Agent 直挂核心工具 + 内置截断 + 按需 Subagent 逃生舱」
- 知识库、受控主机、联网搜索分别封装为 `pi-durable` 的 `Extension`（`kb`、`host`、`web`）。
- 常规场景下，主 Agent 直接调用已勾选作用域内的精简工具（`kb_search`、`kb_read`、`host_exec`、`host_read_log`、`web_search`、`web_fetch`），省去强制子 Agent 中转的额外 LLM 往返延迟，并由 `pi-durable` 原生输出截断器保护上下文窗口。
- 同时提供基于 `pi-durable` 原生 Task-owned Child Conversation 的 `delegate_subagent` 工具：当遇到多步试错、大规模日志排查或复杂检索时，主 Agent 可派生独立子会话隔离执行，仅将最终结论回传主上下文。

### 4. 收敛为单文件 SQLite 混合检索（Hybrid RAG）
- 彻底移除 ChromaDB 与 Python `jieba`/`rank-bm25` 依赖，所有业务表与 RAG 索引全部收敛至单文件 SQLite（`node:sqlite` WAL 模式）：
  - **向量检索**：Chunk 向量以 `Float32Array` 二进制 `BLOB` 存入 SQLite `kb_chunks` 表，按 `kb_id` 过滤后在内存中执行高速余弦相似度计算。
  - **BM25 全文检索**：利用 Node.js 原生内置的 `Intl.Segmenter("zh-CN", { granularity: "word" })` 分词，写入 SQLite 原生 **FTS5 虚拟表**，直接通过 SQL `bm25()` 函数毫秒级排序召回。
  - **混合重排**：通过 RRF（倒数秩融合）合并向量与 FTS5 召回结果；利用 SQLite 外键 `ON DELETE CASCADE` 保证删除文档/知识库时的强一致性。

### 5. 多模型渠道管理与思考深度控制
- 基于 `@earendil-works/pi-ai` 支持配置多 LLM Provider（OpenAI 兼容、Anthropic、Google Gemini 等）与模型列表。
- 会话界面支持实时切换模型（`model`）与思考深度（`thinkingLevel: "off" | "low" | "medium" | "high"`）。

## Consequences

- **正向收益**:
  - 前后端 100% TypeScript 统一，共享类型定义，消除約 3,000 行手写状态同步、流拼装与冗余 `Chat`/`Bots` 代码。
  - 单一 Node.js 进程 + 单一 SQLite 数据库文件即可完整运行，备份与容器化部署极简。
  - 原生获得崩溃恢复、刷新不断流、运行中 `steer` 插话、自动后台上下文压缩（Compaction）与多模型思考深度控制。
- **成本与权衡**:
  - 需要用 TypeScript（`ssh2`、`unpdf`、`mammoth`、`node:crypto`）重写受控主机连接器、文档解析、Vault 同步与 QQ 网关。
  - 采用全新 SQLite Schema，不兼容旧版 Python 数据库文件。
