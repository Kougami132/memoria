# Memoria 2.0

基于 `@earendil-works/pi-durable@1.1.0`、`@earendil-works/pi-ai@1.1.0` 与 Node.js 原生内置单文件 `node:sqlite` 构建的全栈 TypeScript **个人知识库与受控主机运维 AI Agent 平台**。

---

## 核心特性

- **持久化状态机 Agent 引擎（`pi-durable` Harness）**
  - **事务级落盘与崩溃自愈**：所有会话（`Conversation`）、消息记录（`Entry`）、工具调用任务（`Task`）、Token 消耗（`pi.usage`）与会话配置文档均通过 SQLite WAL 事务原子提交，服务重启后可无缝恢复。
  - **实时快照与增量流（`watchEvents`）**：前端直连 `/api/conversations/:id/events`，先下发完整状态快照（Snapshot）再推送 80ms 级流式增量，**支持长任务中途刷新页面不断流**。
  - **运行中插话纠偏（`Steer`）与排队追问（`Follow-up`）**：Agent 执行工具或生成回答期间，用户无需中止即可直接发送插话实时修正方向，或排队追问下一轮。
  - **自动上下文压缩（Compaction）与输出截断**：内置滑动窗口输出截断与长对话自动摘要压缩，防止大日志或长历史撑爆模型上下文。

- **会话级作用域按需挂载（Scope Toggles）**
  - 全局统一的 **AI Agent 对话工作台**，可在每个会话顶部随时勾选启用特定 **知识库（KBs）**、**受控主机（Hosts）** 与 **联网搜索（Web Search）**（持久化于会话文档 `memoria.scope`）。
  - 未勾选领域的工具与提示词绝不注入当前会话上下文，保持模型注意力高度集中。

- **多模型渠道与思考深度控制（`pi-ai` Providers）**
  - 支持在「系统设置」中配置多个大模型服务商渠道（`openai-completions`、`openai-responses`、`anthropic-messages`、`google-generative-ai`）。
  - 在对话界面顶部支持按会话实时切换 **模型（Provider / Model）** 与 **思考深度（Thinking Level：`关` / `低` / `中` / `高`）**。

- **单文件 SQLite 混合检索（Hybrid RAG）与 Vault 同步**
  - **零外部向量库进程依赖**：向量与全文索引全部收敛于同一个 `data/memoria.db` 文件。
  - **稠密向量 + FTS5 BM25 + RRF 融合**：结合 `Float32Array` BLOB 余弦相似度与 SQLite 原生 **FTS5 虚拟表** `bm25()` 排序（配合 Node.js 内置 `Intl.Segmenter("zh-CN")` 中文分词），通过倒数秩融合（RRF）召回高相关片段。
  - **多格式解析与 Vault 自动同步**：支持 `.md`、`.markdown`、`.txt`、`.pdf`、`.docx`、`.yaml` 上传解析，以及本地目录 / WebDAV Vault 的 SHA-256 增量同步（内置断连防误删保护阈值）。

- **受控主机 SSH 连接器与持久化审批流**
  - **凭据强加密与代理穿透**：主机密码、私钥与含认证的 `proxy_url` 均采用 `node:crypto` PBKDF2 + AES-256-GCM 加密存储，接口脱敏回显（`******`）；支持 `http://`、`https://`、`socks5://`、`socks5h://`（默认远程 DNS `rdns=true`）隧道穿透与分层连通性诊断。
  - **三级安全策略（`CommandGuard`）**：
    - `read_only`（只读安全）：仅允许白名单查询指令（如 `uptime`、`df -h`、`free -m`、`docker ps`），其余直接拦截。
    - `ask_confirmation`（审批确认）：非白名单指令触发持久化挂起，向 Web 控制台与 QQ 推送待审批卡片，批准后**在同一工具任务内原地恢复执行**。
    - `unrestricted`（自由执行）：除高危黑名单外直接执行。
    - 高危黑名单指令（如 `rm -rf /`、`mkfs`、磁盘覆写等）在所有模式下均被硬拦截。

- **多通道统一接入**
  - **Web SPA**：内嵌 React 19 + Tailwind CSS 控制台（AI Agent、知识库、主机管理、日志、模块化系统设置）。
  - **OpenAI 兼容 API**：提供 `/v1/models` 与 `/v1/chat/completions`（支持 Bearer Token 鉴权与 `<thought>` 推理块输出）。
  - **QQ 官方机器人通道**：支持 C2C 私聊与群聊 `@` 接入、白名单过滤、代码块闭合切片以及在 QQ 内直接回复 `批准` / `拒绝` 审批主机指令。

---

## Agent 扩展与工具矩阵

Memoria 2.0 基于 `pi-durable` 的 `Extension` 机制组织能力，采用 **「主 Agent 直调精简工具 + 按需派生 Subagent 隔离子会话」** 架构：

| 扩展名称 (`Extension`) | 挂载条件 (`memoria.scope`) | 工具名称 | 功能说明 |
| :--- | :--- | :--- | :--- |
| **`memoria-base`** | 默认常驻 | - | 渲染全局系统提示词与基础行为准则 |
| **`knowledge`** | `scope.kbIds.length > 0` | `kb_search` | 在当前会话已勾选的知识库中执行向量 + FTS5 BM25 混合检索 (RRF) |
| | | `kb_read` | 按 `doc_id` 读取已授权知识库文档全文或片段（防止切片断裂） |
| **`host`** | `scope.hostIds.length > 0` | `host_exec` | 在已勾选受控主机上执行受 `CommandGuard` 保护与审批约束的命令 |
| | | `host_read_log` | 安全读取受控主机日志文件末尾指定行数（强制截断保护） |
| **`web`** | `scope.webSearch === true` | `web_search` | 检索公网网页与技术文档（支持 DuckDuckGo 免 Key、Tavily、SearXNG） |
| | | `web_fetch` | 抓取公开网页 URL 正文并清洗为纯文本 |
| **`subagent`** | `scope.subagentEnabled` | `delegate_subagent` | 派生由当前任务拥有的隔离子会话（Task-owned Child Conversation）处理多步重度排障，仅将最终结论回传主上下文 |

---

## 环境要求与快速开始

### 环境要求
- **Node.js `>= 22.19.0`**（推荐 Node.js 22 LTS 或 Node.js 24，使用内置 `node:sqlite` 与原生 TypeScript 支持）

### 本地安装与运行

```bash
# 1. 安装后端依赖
npm install

# 2. 构建 Web 前端静态资源 (产物输出至 memoria/static)
npm run build:web

# 3. 启动服务 (默认监听 http://localhost:8000)
npm start
```

开发模式（支持后端热重载）：

```bash
npm run dev
```

### 类型检查与测试

```bash
# TypeScript 严格类型检查
npm run typecheck

# 运行 Vitest 全量集成测试 (带 15s 超时保护)
npm test
```

---

## Docker 部署

### 使用 Docker Compose

```yaml
version: "3.8"

services:
  memoria:
    build: .
    image: ghcr.io/kougami132/memoria:latest
    container_name: memoria
    restart: unless-stopped
    ports:
      - "8000:8000"
    volumes:
      - ./data:/app/data
    environment:
      - PORT=8000
      - DB_PATH=/app/data/memoria.db
      - OPENAI_BASE_URL=https://api.openai.com/v1
      - OPENAI_API_KEY=sk-xxxxx
      - LLM_MODEL=deepseek-v4-flash
      - EMBEDDING_MODEL=text-embedding-3-large
```

启动容器：

```bash
docker compose up -d
```

---

## 环境变量配置 (`.env`)

所有配置项均可在 Web 界面 **「系统设置」** 中运行时动态修改并持久化至 SQLite（优先级高于环境变量）：

```ini
# 服务端口与单文件数据库路径
PORT=8000
DB_PATH=./data/memoria.db
MEMORIA_SECRET_KEY=change_me_in_production

# 默认模型渠道配置
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=sk-xxxxx
LLM_MODEL=deepseek-v4-flash
EMBEDDING_MODEL=text-embedding-3-large

# 外部 /v1 接口鉴权 Token (留空则免鉴权)
EXTERNAL_API_TOKEN=

# RAG 检索默认参数
CHUNK_SIZE=512
CHUNK_OVERLAP=128
TOP_K=5
MIN_SCORE=0.5

# 联网搜索默认配置
ENABLE_WEB_SEARCH=false
WEB_SEARCH_PROVIDER=duckduckgo
```

---

## 项目目录结构

```text
memoria/
├── src/                            # TypeScript 服务端源码 (Node.js >= 22.19)
│   ├── index.ts                    # HTTP 服务入口与静态资源托管
│   ├── server/
│   │   └── app.ts                  # Hono 路由网关 (/api/* 与 /v1/*)
│   ├── db/
│   │   └── database.ts             # 单文件 node:sqlite (WAL) Schema 与 CRUD
│   ├── agent/
│   │   ├── runtime.ts              # pi-durable Harness 封装与会话编排
│   │   ├── documents.ts            # 会话作用域文档定义 (memoria.scope)
│   │   ├── extensions.ts           # Knowledge / Host / Web / Subagent 扩展与工具
│   │   ├── models-registry.ts      # pi-ai 多模型渠道注册表管理
│   │   └── web-search.ts           # DuckDuckGo / Tavily / SearXNG 检索与网页提取
│   ├── rag/
│   │   ├── parser.ts               # .md / .txt / .pdf / .docx / .yaml 解析与分块
│   │   ├── embedder.ts             # Float32Array 向量化与余弦相似度计算
│   │   └── hybrid-retriever.ts     # SQLite 向量 + FTS5 中文分词 BM25 + RRF 混合检索
│   ├── vault/
│   │   └── syncer.ts               # Local / WebDAV Vault 连接器与 SHA-256 增量同步
│   ├── host/
│   │   ├── crypto.ts               # AES-256-GCM 凭据加密与解密
│   │   ├── proxy.ts                # HTTP CONNECT / SOCKS5 (rdns) 代理隧道与脱敏
│   │   ├── guard.ts                # CommandGuard 三级安全策略与持久化审批管理器
│   │   └── executor.ts             # 受控主机管理、分层连通性诊断与命令执行
│   └── qqbot/
│       └── service.ts              # QQ 官方机器人策略、Markdown 分片与审批交互
├── shared/
│   └── types.ts                    # 前后端共享 TypeScript 类型契约
├── web/                            # React 19 + Vite + Tailwind CSS 前端源码
├── tests-ts/                       # Vitest 集成测试套件 (M1 ~ M4)
├── docs/                           # 领域上下文 (CONTEXT.md) 与架构决策记录 (ADR 0001~0007)
├── package.json
├── tsconfig.json
└── Dockerfile
```

