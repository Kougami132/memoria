---
change: setup-project-skeleton
design-doc: docs/superpowers/specs/2026-06-25-setup-project-skeleton-design.md
base-ref: initial
---

# Setup Project Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 memoria 标准 Python 包骨架（方案 B：接口骨架），所有模块可导入，CLI `--help` 可运行，pytest 可启动。

**Architecture:** 单一 Python 包 `memoria/`，通过 `pyproject.toml` 安装并注册 CLI entrypoint。`config.py` 和 `models/` 完整实现；`core/`、`storage/`、`llm/`、`server/` 提供函数/类签名骨架（`raise NotImplementedError`）；`cli/main.py` 构建完整命令树 stub，使 `memoria --help` 能展示全部命令。

**Tech Stack:** Python 3.11+, pydantic-settings 2.x, pydantic 2.x, fastapi 0.115+, click 8.1+, sqlalchemy 2.x, chromadb 0.5+, pytest 8+

## Global Constraints

- Python >= 3.11（类型注解使用 `str | list[str]` union 语法，无需 `from __future__ import annotations`）
- 所有依赖版本严格遵循 Design Doc 依赖清单，不得降级或添加额外依赖
- 工作目录：`N:/Data/Projects/memoria/`（后文所有路径均相对此根）
- 骨架函数体只允许 `raise NotImplementedError`，不得包含任何业务逻辑
- `pydantic-settings` `Settings` 类中使用嵌套 `class Config: env_file = ".env"`（pydantic-settings 2.x 兼容写法）

---

## File Map

| 文件 | 责任 |
|------|------|
| `pyproject.toml` | 包元数据、依赖声明、pytest 配置、CLI entrypoint |
| `.env.example` | 所有配置键的占位示例 |
| `.gitignore` | 排除敏感/生成文件 |
| `memoria/__init__.py` | 包入口，导出版本号 |
| `memoria/config.py` | pydantic-settings Settings 完整实现 |
| `memoria/models/__init__.py` | 重导出三个模型类 |
| `memoria/models/bot.py` | Bot Pydantic 模型 |
| `memoria/models/knowledge_base.py` | KnowledgeBase Pydantic 模型 |
| `memoria/models/document.py` | Document Pydantic 模型 |
| `memoria/core/__init__.py` | 空包标记 |
| `memoria/core/pipeline.py` | ingest/retrieve/query 签名骨架 |
| `memoria/core/chunker.py` | Chunker 类签名骨架 |
| `memoria/core/embedder.py` | Embedder 类签名骨架 |
| `memoria/storage/__init__.py` | 空包标记 |
| `memoria/storage/base.py` | VectorStore ABC |
| `memoria/storage/chroma_store.py` | ChromaStore 继承 VectorStore，方法均 NotImplementedError |
| `memoria/storage/db.py` | SQLAlchemy DB 类骨架 |
| `memoria/llm/__init__.py` | 空包标记 |
| `memoria/llm/caller.py` | LLMCaller 类骨架 |
| `memoria/server/__init__.py` | 空包标记 |
| `memoria/server/app.py` | create_app() FastAPI 工厂 |
| `memoria/server/deps.py` | 依赖注入骨架 |
| `memoria/server/routes/__init__.py` | 空包标记 |
| `memoria/server/routes/knowledge_bases.py` | router 骨架 |
| `memoria/server/routes/bots.py` | router 骨架 |
| `memoria/server/routes/documents.py` | router 骨架 |
| `memoria/server/routes/chat.py` | router 骨架 |
| `memoria/cli/__init__.py` | 空包标记 |
| `memoria/cli/main.py` | 完整命令树 stub（serve/kb/bot/ingest/query） |
| `tests/conftest.py` | 空 conftest |
| `tests/test_placeholder.py` | 占位测试 |
| `README.md` | 安装与开发说明 |

---

## Group 1: 项目配置文件

### Task 1.1: 创建 `pyproject.toml`

**Files:**
- Create: `pyproject.toml`

**Interfaces:**
- Produces: 包名 `memoria`，entrypoint `memoria = "memoria.cli.main:cli"`，pytest 可发现 `tests/`

- [ ] **Step 1: 创建 `pyproject.toml`**

```toml
[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.backends.legacy:build"

[project]
name = "memoria"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.32",
    "chromadb>=0.5",
    "openai>=1.54",
    "langchain-text-splitters>=0.3",
    "python-dotenv>=1.0",
    "pydantic>=2.0",
    "pydantic-settings>=2.0",
    "sqlalchemy>=2.0",
    "click>=8.1",
]

[project.scripts]
memoria = "memoria.cli.main:cli"

[project.optional-dependencies]
dev = ["pytest>=8", "pytest-asyncio>=0.24", "black>=24", "ruff>=0.7"]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

- [ ] **Step 2: 验证文件存在且 TOML 语法有效**

```bash
python -c "import tomllib; tomllib.load(open('N:/Data/Projects/memoria/pyproject.toml','rb'))" && echo OK
```

Expected: `OK`

- [ ] **Step 3: Commit**

```bash
cd N:/Data/Projects/memoria && git add pyproject.toml && git commit -m "chore: add pyproject.toml with Phase 1 dependencies"
```

---

### Task 1.2: 创建 `.env.example`

**Files:**
- Create: `.env.example`

**Interfaces:**
- Produces: 与 `memoria/config.py` Settings 字段一一对应的键名（供下游任务核对）

- [ ] **Step 1: 创建 `.env.example`**

```ini
NEWAPI_BASE_URL=https://api.example.com
NEWAPI_API_KEY=your-api-key-here
EMBEDDING_MODEL=text-embedding-3-large
LLM_MODEL=deepseek-v4-flash
CHUNK_SIZE=512
CHUNK_OVERLAP=128
TOP_K=5
DB_PATH=./data/memoria.db
CHROMA_PATH=./data/chroma
UPLOAD_DIR=./data/uploads
```

- [ ] **Step 2: 验证键名完整性**

```bash
grep -c "=" N:/Data/Projects/memoria/.env.example
```

Expected: `10`（10 个键）

- [ ] **Step 3: Commit**

```bash
cd N:/Data/Projects/memoria && git add .env.example && git commit -m "chore: add .env.example with all config keys"
```

---

### Task 1.3: 创建 `.gitignore`

**Files:**
- Create: `.gitignore`

- [ ] **Step 1: 创建 `.gitignore`**

```gitignore
.env
data/
__pycache__/
.venv/
*.pyc
.pytest_cache/
dist/
*.egg-info/
.eggs/
```

- [ ] **Step 2: Commit**

```bash
cd N:/Data/Projects/memoria && git add .gitignore && git commit -m "chore: add .gitignore"
```

---

## Group 2: Python 包目录结构

### Task 2.1: 创建 `memoria/__init__.py`

**Files:**
- Create: `memoria/__init__.py`

**Interfaces:**
- Produces: `from memoria import __version__` 可用

- [ ] **Step 1: 创建目录和 `__init__.py`**

```bash
mkdir -p N:/Data/Projects/memoria/memoria
```

文件内容 `memoria/__init__.py`：

```python
__version__ = "0.1.0"
```

- [ ] **Step 2: 验证可导入**

```bash
cd N:/Data/Projects/memoria && python -c "import memoria; print(memoria.__version__)"
```

Expected: `0.1.0`

- [ ] **Step 3: Commit**

```bash
cd N:/Data/Projects/memoria && git add memoria/__init__.py && git commit -m "feat: create memoria package"
```

---

### Task 2.2: 创建 `memoria/config.py`（完整实现）

**Files:**
- Create: `memoria/config.py`

**Interfaces:**
- Consumes: pydantic-settings（需已安装）
- Produces: `from memoria.config import settings`，`settings.newapi_base_url` 等 10 个字段可访问

- [ ] **Step 1: 创建 `memoria/config.py`**

```python
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    newapi_base_url: str
    newapi_api_key: str
    embedding_model: str = "text-embedding-3-large"
    llm_model: str = "deepseek-v4-flash"
    chunk_size: int = 512
    chunk_overlap: int = 128
    top_k: int = 5
    db_path: str = "./data/memoria.db"
    chroma_path: str = "./data/chroma"
    upload_dir: str = "./data/uploads"

    class Config:
        env_file = ".env"


settings = Settings()
```

- [ ] **Step 2: 创建测试用 `.env` 验证导入**

```bash
echo "NEWAPI_BASE_URL=http://test\nNEWAPI_API_KEY=testkey" > N:/Data/Projects/memoria/.env.test
```

- [ ] **Step 3: 验证模块可导入（使用测试 .env）**

```bash
cd N:/Data/Projects/memoria && NEWAPI_BASE_URL=http://test NEWAPI_API_KEY=testkey python -c "
from memoria.config import Settings
s = Settings()
assert s.chunk_size == 512
assert s.top_k == 5
print('config OK')
"
```

Expected: `config OK`

- [ ] **Step 4: 清理测试 .env**

```bash
rm -f N:/Data/Projects/memoria/.env.test
```

- [ ] **Step 5: Commit**

```bash
cd N:/Data/Projects/memoria && git add memoria/config.py && git commit -m "feat: add config.py with pydantic-settings"
```

---

### Task 2.3: 创建 `memoria/core/` 骨架

**Files:**
- Create: `memoria/core/__init__.py`
- Create: `memoria/core/pipeline.py`
- Create: `memoria/core/chunker.py`
- Create: `memoria/core/embedder.py`

**Interfaces:**
- Produces:
  - `pipeline.ingest(kb_id: str, path: str | list[str]) -> dict`
  - `pipeline.retrieve(kb_id: str, query: str, k: int = 5) -> list[dict]`
  - `pipeline.query(bot_id: str, query: str, stream: bool = False) -> dict`
  - `chunker.Chunker.split(text: str) -> list[str]`
  - `embedder.Embedder.embed(texts: list[str]) -> list[list[float]]`

- [ ] **Step 1: 创建 `memoria/core/__init__.py`（空文件）**

```python
```

- [ ] **Step 2: 创建 `memoria/core/pipeline.py`**

```python
def ingest(kb_id: str, path: str | list[str]) -> dict:
    raise NotImplementedError


def retrieve(kb_id: str, query: str, k: int = 5) -> list[dict]:
    raise NotImplementedError


def query(bot_id: str, query: str, stream: bool = False) -> dict:
    raise NotImplementedError
```

- [ ] **Step 3: 创建 `memoria/core/chunker.py`**

```python
class Chunker:
    def __init__(self, chunk_size: int = 512, chunk_overlap: int = 128) -> None:
        raise NotImplementedError

    def split(self, text: str) -> list[str]:
        raise NotImplementedError
```

- [ ] **Step 4: 创建 `memoria/core/embedder.py`**

```python
class Embedder:
    def __init__(self, model: str) -> None:
        raise NotImplementedError

    def embed(self, texts: list[str]) -> list[list[float]]:
        raise NotImplementedError
```

- [ ] **Step 5: 验证可导入**

```bash
cd N:/Data/Projects/memoria && python -c "
from memoria.core import pipeline, chunker, embedder
print('core OK')
"
```

Expected: `core OK`

- [ ] **Step 6: Commit**

```bash
cd N:/Data/Projects/memoria && git add memoria/core/ && git commit -m "feat: add core/ skeleton (pipeline, chunker, embedder)"
```

---

### Task 2.4: 创建 `memoria/storage/` 骨架

**Files:**
- Create: `memoria/storage/__init__.py`
- Create: `memoria/storage/base.py`
- Create: `memoria/storage/chroma_store.py`
- Create: `memoria/storage/db.py`

**Interfaces:**
- Produces:
  - `base.VectorStore` ABC，方法：`add(ids, embeddings, documents)`, `query(embedding, k)`, `delete(ids)`
  - `chroma_store.ChromaStore(VectorStore)`，方法均 `raise NotImplementedError`
  - `db.DB`，方法：`get(id)`, `list()`, `create(obj)`, `delete(id)` 均 `raise NotImplementedError`

- [ ] **Step 1: 创建 `memoria/storage/__init__.py`（空文件）**

```python
```

- [ ] **Step 2: 创建 `memoria/storage/base.py`**

```python
from abc import ABC, abstractmethod


class VectorStore(ABC):
    @abstractmethod
    def add(self, ids: list[str], embeddings: list[list[float]], documents: list[str]) -> None:
        raise NotImplementedError

    @abstractmethod
    def query(self, embedding: list[float], k: int = 5) -> list[dict]:
        raise NotImplementedError

    @abstractmethod
    def delete(self, ids: list[str]) -> None:
        raise NotImplementedError
```

- [ ] **Step 3: 创建 `memoria/storage/chroma_store.py`**

```python
from memoria.storage.base import VectorStore


class ChromaStore(VectorStore):
    def __init__(self, path: str, collection_name: str) -> None:
        raise NotImplementedError

    def add(self, ids: list[str], embeddings: list[list[float]], documents: list[str]) -> None:
        raise NotImplementedError

    def query(self, embedding: list[float], k: int = 5) -> list[dict]:
        raise NotImplementedError

    def delete(self, ids: list[str]) -> None:
        raise NotImplementedError
```

- [ ] **Step 4: 创建 `memoria/storage/db.py`**

```python
class DB:
    def __init__(self, db_path: str) -> None:
        raise NotImplementedError

    def get(self, id: str) -> dict | None:
        raise NotImplementedError

    def list(self) -> list[dict]:
        raise NotImplementedError

    def create(self, obj: dict) -> dict:
        raise NotImplementedError

    def delete(self, id: str) -> None:
        raise NotImplementedError
```

- [ ] **Step 5: 验证可导入**

```bash
cd N:/Data/Projects/memoria && python -c "
from memoria.storage.base import VectorStore
from memoria.storage.chroma_store import ChromaStore
from memoria.storage.db import DB
print('storage OK')
"
```

Expected: `storage OK`

- [ ] **Step 6: Commit**

```bash
cd N:/Data/Projects/memoria && git add memoria/storage/ && git commit -m "feat: add storage/ skeleton (VectorStore ABC, ChromaStore, DB)"
```

---

### Task 2.5: 创建 `memoria/models/` 完整实现

**Files:**
- Create: `memoria/models/__init__.py`
- Create: `memoria/models/bot.py`
- Create: `memoria/models/knowledge_base.py`
- Create: `memoria/models/document.py`

**Interfaces:**
- Produces:
  - `from memoria.models import Bot, KnowledgeBase, Document`
  - `Bot(id, name, system_prompt, kb_ids, model_override)`
  - `KnowledgeBase(id, name, description)`
  - `Document(id, kb_id, filename, path, chunk_count)`

- [ ] **Step 1: 创建 `memoria/models/bot.py`**

```python
from pydantic import BaseModel


class Bot(BaseModel):
    id: str
    name: str
    system_prompt: str = ""
    kb_ids: list[str] = []
    model_override: str | None = None
```

- [ ] **Step 2: 创建 `memoria/models/knowledge_base.py`**

```python
from pydantic import BaseModel


class KnowledgeBase(BaseModel):
    id: str
    name: str
    description: str = ""
```

- [ ] **Step 3: 创建 `memoria/models/document.py`**

```python
from pydantic import BaseModel


class Document(BaseModel):
    id: str
    kb_id: str
    filename: str
    path: str
    chunk_count: int = 0
```

- [ ] **Step 4: 创建 `memoria/models/__init__.py`**

```python
from memoria.models.bot import Bot
from memoria.models.knowledge_base import KnowledgeBase
from memoria.models.document import Document

__all__ = ["Bot", "KnowledgeBase", "Document"]
```

- [ ] **Step 5: 验证模型可实例化**

```bash
cd N:/Data/Projects/memoria && python -c "
from memoria.models import Bot, KnowledgeBase, Document
b = Bot(id='b1', name='test')
kb = KnowledgeBase(id='k1', name='demo')
d = Document(id='d1', kb_id='k1', filename='f.pdf', path='/tmp/f.pdf')
assert b.kb_ids == []
assert kb.description == ''
assert d.chunk_count == 0
print('models OK')
"
```

Expected: `models OK`

- [ ] **Step 6: Commit**

```bash
cd N:/Data/Projects/memoria && git add memoria/models/ && git commit -m "feat: add models/ with Bot, KnowledgeBase, Document"
```

---

### Task 2.6: 创建 `memoria/llm/` 骨架

**Files:**
- Create: `memoria/llm/__init__.py`
- Create: `memoria/llm/caller.py`

**Interfaces:**
- Produces: `llm.caller.LLMCaller.call(messages: list[dict], stream: bool) -> dict | Iterator`

- [ ] **Step 1: 创建 `memoria/llm/__init__.py`（空文件）**

```python
```

- [ ] **Step 2: 创建 `memoria/llm/caller.py`**

```python
from typing import Iterator


class LLMCaller:
    def __init__(self, base_url: str, api_key: str, model: str) -> None:
        raise NotImplementedError

    def call(self, messages: list[dict], stream: bool = False) -> dict | Iterator:
        raise NotImplementedError
```

- [ ] **Step 3: 验证可导入**

```bash
cd N:/Data/Projects/memoria && python -c "
from memoria.llm.caller import LLMCaller
print('llm OK')
"
```

Expected: `llm OK`

- [ ] **Step 4: Commit**

```bash
cd N:/Data/Projects/memoria && git add memoria/llm/ && git commit -m "feat: add llm/ skeleton (LLMCaller)"
```

---

### Task 2.7: 创建 `memoria/server/` 骨架

**Files:**
- Create: `memoria/server/__init__.py`
- Create: `memoria/server/app.py`
- Create: `memoria/server/deps.py`
- Create: `memoria/server/routes/__init__.py`
- Create: `memoria/server/routes/knowledge_bases.py`
- Create: `memoria/server/routes/bots.py`
- Create: `memoria/server/routes/documents.py`
- Create: `memoria/server/routes/chat.py`

**Interfaces:**
- Produces: `from memoria.server.app import create_app` 返回 `FastAPI` 实例

- [ ] **Step 1: 创建 `memoria/server/__init__.py`（空文件）**

```python
```

- [ ] **Step 2: 创建 `memoria/server/app.py`**

```python
from fastapi import FastAPI


def create_app() -> FastAPI:
    app = FastAPI(title="Memoria")
    # 路由注册占位
    return app
```

- [ ] **Step 3: 创建 `memoria/server/deps.py`**

```python
def get_settings():
    raise NotImplementedError
```

- [ ] **Step 4: 创建 `memoria/server/routes/__init__.py`（空文件）**

```python
```

- [ ] **Step 5: 创建 `memoria/server/routes/knowledge_bases.py`**

```python
from fastapi import APIRouter

router = APIRouter(prefix="/knowledge-bases", tags=["knowledge-bases"])
```

- [ ] **Step 6: 创建 `memoria/server/routes/bots.py`**

```python
from fastapi import APIRouter

router = APIRouter(prefix="/bots", tags=["bots"])
```

- [ ] **Step 7: 创建 `memoria/server/routes/documents.py`**

```python
from fastapi import APIRouter

router = APIRouter(prefix="/documents", tags=["documents"])
```

- [ ] **Step 8: 创建 `memoria/server/routes/chat.py`**

```python
from fastapi import APIRouter

router = APIRouter(prefix="/chat", tags=["chat"])
```

- [ ] **Step 9: 验证 FastAPI app 可创建**

```bash
cd N:/Data/Projects/memoria && python -c "
from memoria.server.app import create_app
app = create_app()
assert app.title == 'Memoria'
print('server OK')
"
```

Expected: `server OK`

- [ ] **Step 10: Commit**

```bash
cd N:/Data/Projects/memoria && git add memoria/server/ && git commit -m "feat: add server/ skeleton (FastAPI app + route stubs)"
```

---

### Task 2.8: 创建 `memoria/cli/main.py`（完整命令树 stub）

**Files:**
- Create: `memoria/cli/__init__.py`
- Create: `memoria/cli/main.py`

**Interfaces:**
- Consumes: click 8.1+
- Produces: `cli` Click group，子命令：`serve`、`kb create/list/delete`、`bot create/list/delete`、`ingest`、`query`

- [ ] **Step 1: 创建 `memoria/cli/__init__.py`（空文件）**

```python
```

- [ ] **Step 2: 创建 `memoria/cli/main.py`**

```python
import click


@click.group()
def cli() -> None:
    """Memoria — Personal Knowledge Base Assistant."""


@cli.command()
@click.option("--host", default="0.0.0.0", show_default=True)
@click.option("--port", default=8000, show_default=True)
def serve(host: str, port: int) -> None:
    """Start the Memoria API server."""
    raise NotImplementedError


@cli.group()
def kb() -> None:
    """Knowledge base management."""


@kb.command("create")
@click.argument("name")
def kb_create(name: str) -> None:
    """Create a new knowledge base."""
    raise NotImplementedError


@kb.command("list")
def kb_list() -> None:
    """List all knowledge bases."""
    raise NotImplementedError


@kb.command("delete")
@click.argument("kb_id")
def kb_delete(kb_id: str) -> None:
    """Delete a knowledge base."""
    raise NotImplementedError


@cli.group()
def bot() -> None:
    """Bot management."""


@bot.command("create")
@click.argument("name")
def bot_create(name: str) -> None:
    """Create a new bot."""
    raise NotImplementedError


@bot.command("list")
def bot_list() -> None:
    """List all bots."""
    raise NotImplementedError


@bot.command("delete")
@click.argument("bot_id")
def bot_delete(bot_id: str) -> None:
    """Delete a bot."""
    raise NotImplementedError


@cli.command()
@click.argument("kb_id")
@click.argument("path")
def ingest(kb_id: str, path: str) -> None:
    """Ingest a file or directory into a knowledge base."""
    raise NotImplementedError


@cli.command()
@click.argument("bot_id")
@click.argument("question")
def query(bot_id: str, question: str) -> None:
    """Query a bot."""
    raise NotImplementedError
```

- [ ] **Step 3: 验证 `memoria --help` 输出**

先确认包已安装（若尚未安装则先执行 `pip install -e .`）：

```bash
cd N:/Data/Projects/memoria && pip install -e . -q && memoria --help
```

Expected output 包含：
```
Usage: memoria [OPTIONS] COMMAND [ARGS]...

  Memoria — Personal Knowledge Base Assistant.

Commands:
  bot     Bot management.
  ingest  Ingest a file or directory into a knowledge base.
  kb      Knowledge base management.
  query   Query a bot.
  serve   Start the Memoria API server.
```

- [ ] **Step 4: Commit**

```bash
cd N:/Data/Projects/memoria && git add memoria/cli/ && git commit -m "feat: add cli/ with full command tree stub"
```

---

## Group 3: 测试与文档

### Task 3.1 + 3.2: 创建 `tests/` 目录和占位测试

**Files:**
- Create: `tests/conftest.py`
- Create: `tests/test_placeholder.py`

**Interfaces:**
- Produces: `pytest` 可运行，退出码 0 或 5（no tests collected 时为 5，有测试时为 0）

- [ ] **Step 1: 创建 `tests/conftest.py`（空文件）**

```python
```

- [ ] **Step 2: 创建 `tests/test_placeholder.py`**

```python
def test_import_memoria() -> None:
    import memoria
    assert memoria.__version__ == "0.1.0"


def test_models_instantiation() -> None:
    from memoria.models import Bot, KnowledgeBase, Document

    bot = Bot(id="b1", name="test-bot")
    kb = KnowledgeBase(id="k1", name="test-kb")
    doc = Document(id="d1", kb_id="k1", filename="a.pdf", path="/tmp/a.pdf")

    assert bot.kb_ids == []
    assert kb.description == ""
    assert doc.chunk_count == 0
```

- [ ] **Step 3: 运行测试确认通过**

```bash
cd N:/Data/Projects/memoria && pytest -v
```

Expected:
```
tests/test_placeholder.py::test_import_memoria PASSED
tests/test_placeholder.py::test_models_instantiation PASSED
2 passed
```

- [ ] **Step 4: Commit**

```bash
cd N:/Data/Projects/memoria && git add tests/ && git commit -m "test: add placeholder tests for import and models"
```

---

### Task 3.3: 创建 `README.md`

**Files:**
- Create: `README.md`（注：项目根已有 DESIGN.md，README.md 是新文件）

- [ ] **Step 1: 创建 `README.md`**

```markdown
# Memoria

Personal knowledge base assistant powered by RAG.

## Installation

```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
cp .env.example .env
# Edit .env and fill in NEWAPI_BASE_URL and NEWAPI_API_KEY
```

## CLI Usage

```
$ memoria --help
Usage: memoria [OPTIONS] COMMAND [ARGS]...

  Memoria — Personal Knowledge Base Assistant.

Commands:
  bot     Bot management.
  ingest  Ingest a file or directory into a knowledge base.
  kb      Knowledge base management.
  query   Query a bot.
  serve   Start the Memoria API server.
```

## Development

```bash
pytest          # Run tests
ruff check .    # Lint
black .         # Format
```
```

- [ ] **Step 2: Commit**

```bash
cd N:/Data/Projects/memoria && git add README.md && git commit -m "docs: add README with install and CLI usage"
```

---

## Group 4: 验收验证

### Task 4.1–4.4: 全量验收检查

这一组不创建新文件，执行所有验收命令并确认结果。

- [ ] **Step 1: 确认包安装无报错**

```bash
cd N:/Data/Projects/memoria && pip install -e . 2>&1 | tail -5
```

Expected: 最后一行包含 `Successfully installed` 或 `already satisfied`，无 `ERROR`

- [ ] **Step 2: 确认 import 无报错**

```bash
cd N:/Data/Projects/memoria && python -c "import memoria; print('import OK')"
```

Expected: `import OK`

- [ ] **Step 3: 确认 CLI 可运行**

```bash
cd N:/Data/Projects/memoria && memoria --help
```

Expected: 输出含 `Usage: memoria` 且退出码 0

```bash
echo "Exit code: $?"
```

Expected: `Exit code: 0`

- [ ] **Step 4: 确认 pytest 可启动**

```bash
cd N:/Data/Projects/memoria && pytest -v 2>&1
```

Expected: 退出码 0（有测试通过）或 5（no tests collected）；无 `ImportError` 或 `ModuleNotFoundError`

- [ ] **Step 5: 确认 `memoria kb --help` 和 `memoria bot --help` 子命令可见**

```bash
cd N:/Data/Projects/memoria && memoria kb --help && memoria bot --help
```

Expected: 两个命令均输出各自的 help 文本，退出码 0

- [ ] **Step 6: Final commit（若有遗漏未提交的文件）**

```bash
cd N:/Data/Projects/memoria && git status
```

若有未提交文件：

```bash
cd N:/Data/Projects/memoria && git add -A && git commit -m "chore: skeleton complete, all acceptance checks pass"
```
