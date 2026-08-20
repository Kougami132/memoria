# Memoria

个人知识库助手，基于 RAG（检索增强生成）。支持本地文档上传和 Vault（本地目录 / WebDAV）自动同步，通过 Bot 系统组织多知识库问答，提供 Web UI 和 REST API。

## 功能

- **RAG 问答**：文档切分 → 向量化 → 相似度检索 → LLM 回答，回答附带来源引用
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
    image: ghcr.io/<your-github-username>/memoria:latest
    # 或本地源码构建:
    # build:
    #   context: .
    #   dockerfile: Dockerfile
    container_name: memoria
    restart: unless-stopped
    ports:
      - "8000:8000"
    volumes:
      - ./data:/app/data
    env_file:
      - .env
    environment:
      - DB_PATH=/app/data/memoria.db
      - CHROMA_PATH=/app/data/chroma
      - UPLOAD_DIR=/app/data/uploads
      - LOG_PATH=/app/data/memoria.log
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
