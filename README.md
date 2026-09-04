# Memoria

个人知识库助手，基于 RAG（检索增强生成）。支持本地文档上传和 Vault（本地目录 / WebDAV）自动同步，通过 Bot 系统组织多知识库问答，提供 Web UI 和 REST API。

## 功能

- **RAG 问答**：文档切分 → 向量化 → 相似度检索 → LLM 回答，回答附带来源引用
- **多 Agent 协同（Agent-as-Tool）**：主调度智能体统筹分析，专有 Sub-Agent 负责知识库深度检索与远程主机运维巡检
- **Bot 系统**：每个 Bot 关联多个知识库，拥有独立 System Prompt
- **多轮对话**：Session 持久化对话历史，支持续聊和会话管理
- **Vault 同步**：绑定本地目录或 WebDAV，自动周期同步（默认 15 分钟）
- **Web UI**：内嵌于服务，涵盖对话、知识库管理、Bot 管理、系统设置
- **运行时配置**：Settings 页面可覆盖 API 地址、模型、RAG 参数，无需重启
- **OpenAI 兼容**：支持 OpenAI、Azure、本地部署（Ollama 等）任意兼容接口

## 安装

```bash
python -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
cp .env.example .env
# 编辑 .env，填写 OPENAI_BASE_URL 和 OPENAI_API_KEY
```

## 启动

```bash
memoria serve
```

服务启动后访问 `http://localhost:8000`。

```bash
memoria serve --host 0.0.0.0 --port 8080 --log-file ./data/memoria.log
```

构建 Web UI（开发时修改前端后需重新构建）：

```bash
cd web && npm install && npm run build
```


## Docker 部署

### 使用 Docker Compose（推荐）

在项目根目录下或宿主机创建 `docker-compose.yml`：

```yaml
version: "3.8"

services:
  memoria:
    image: ghcr.io/kougami132/memoria:latest
    container_name: memoria
    restart: unless-stopped
    ports:
      - "8000:8000"
    volumes:
      - ./data:/app/data
    environment:
      - OPENAI_BASE_URL=https://your-api.example.com
      - OPENAI_API_KEY=sk-xxxxx
      - EMBEDDING_MODEL=text-embedding-3-large
      - LLM_MODEL=deepseek-v4-flash
```

启动服务：

```bash
# 启动容器
docker compose up -d

# 查看日志
docker compose logs -f
```

## 配置

编辑 `.env`（参考 `.env.example`）：

```ini
OPENAI_BASE_URL=https://your-api.example.com   # OpenAI 兼容 API 地址
OPENAI_API_KEY=sk-xxxxx

EMBEDDING_MODEL=text-embedding-3-large
LLM_MODEL=deepseek-v4-flash
SYSTEM_PROMPT=你是一个专业的智能助手，请始终用用户所使用的语言回复。如果系统提供了参考资料，请优先基于参考资料回答问题，并保持回答简洁准确。若参考资料不足以回答问题，可结合自身知识补充，但需说明哪部分来自推断而非资料。

CHUNK_SIZE=512
CHUNK_OVERLAP=128
TOP_K=5
MIN_SCORE=0.5
```

以上参数也可在 Web UI「系统设置」页面运行时覆盖，优先级高于 .env。

## CLI

```bash
# 知识库
memoria kb create <name>
memoria kb list
memoria kb delete <kb_id>

# Bot
memoria bot create <name> [--system-prompt "..."]
memoria bot list
memoria bot delete <bot_id>

# 文档入库
memoria ingest <kb_id> <file_or_dir>

# 对话（不走 HTTP，直接调引擎）
memoria query <bot_id> "<问题>" [--session-id <sid>]
```

## Vault

Vault 将本地目录或 WebDAV 挂载为知识库文件源，支持自动周期同步。需先创建 `vault` 类型的知识库，再通过 Web UI 或 API 绑定：

```bash
# 创建 vault 类型知识库
curl -X POST http://localhost:8000/api/knowledge-bases \
  -H 'Content-Type: application/json' \
  -d '{"name": "笔记", "type": "vault"}'

# 绑定本地目录
curl -X POST http://localhost:8000/api/knowledge-bases/<kb_id>/vault \
  -H 'Content-Type: application/json' \
  -d '{"type": "local", "local_path": "/path/to/notes"}'
```

支持格式：`.md`、`.txt`。

## 开发

```bash
pytest           # 运行测试
ruff check .     # Lint
black .          # 格式化
```

## 多 Agent 架构（Agent-as-Tool）

Memoria 采用 **Agent-as-Tool** 架构，将专业领域的复杂能力封装为独立专家智能体（Sub-Agent），由主调度智能体（Orchestrator）统一理解意图、分解任务并委派执行。

### 智能体职责说明

| 智能体 | 角色定位 | 核心职责 |
| :--- | :--- | :--- |
| **Orchestrator（主调度智能体）** | 调度大脑 / 意图分发 | 接收用户会话输入，分析推理任务意图，拆解跨领域子任务，委派给对应的专业智能体并综合多方返回结果输出最终答复。 |
| **KnowledgeAgent（知识库专家）** | 知识检索 / 文档提炼 | 负责多知识库探索与跨库混合检索（向量+关键词），提炼高相关文本片段与参考资料，提供溯源证据链。 |
| **HostAgent（主机运维专家）** | 服务器巡检 / 受控操作 | 负责探测多主机节点状态、系统指标（CPU/内存/磁盘/进程）诊断，并在受控安全策略与审批机制下执行系统指令。 |

### 各 Agent 配备工具

#### 1. Orchestrator 主调度工具
- `delegate_to_knowledge_agent`：委派知识库专家 KnowledgeAgent 进行跨库检索与内容分析。
  - 参数：`query`（查询内容，必填）、`kb_id`（可选指定知识库）、`top_k`（检索数量，默认 5）。
- `delegate_to_host_agent`：委派主机运维专家 HostAgent 执行远程服务器探测、巡检或受控指令。
  - 参数：`instruction`（运维任务描述，必填）、`host_id`（可选目标主机）、`command`（可选指定指令）。

#### 2. KnowledgeAgent 内部工具
- `list_knowledge_bases`：查询当前允许访问的所有知识库元数据及文档统计信息。
- `search_knowledge_base`：在指定的知识库内执行向量与关键词混合检索，返回高相关文本分块。

#### 3. HostAgent 内部工具
- `list_hosts`：查询可用主机与服务器节点、网络地址、标签及运行状态。
- `get_host_info`：获取指定主机的操作系统、负载、内存、磁盘和运行指标详情。
- `run_host_command`：在指定主机上执行受控指令，内置三级安全策略：
  - `read_only`（只读安全）：仅允许白名单中的查询命令，如 `uptime`、`df -h`、`free -m`、`docker ps`，直接执行。
  - `ask_confirmation`（需要审批）：白名单外的命令需通过 Web 或 QQ 会话确认后执行。
  - `unrestricted`（自由执行）：非危险黑名单命令直接执行。
  - 危险黑名单命令（如 `rm -rf /`、格式化硬盘）在所有模式下都会被系统拦截。

### 链路可观测性（Tracing & Logging）

- **Web 界面 Tracing**：全链路呈现调用层级、各 Agent 耗时分布、入参出参以及关联的专家身份徽标。
- **控制台实时日志**：
  - 调度流转：`[AGENT TRACE] [Orchestrator -> HostAgent] [DELEGATE] ...`
  - 专家执行：`[AGENT TRACE] [HostAgent] [TOOL_CALL] ...`
  - 结果交付：`[AGENT TRACE] [HostAgent -> Orchestrator] [DELEGATE_RETURN] ...`

## 架构

详见 [DESIGN.md](DESIGN.md)。

```
Web UI / API 客户端
       │
  FastAPI 服务
       │
  ┌────┴─────┐
SQLite      ChromaDB
（元数据）   （向量索引）
```
