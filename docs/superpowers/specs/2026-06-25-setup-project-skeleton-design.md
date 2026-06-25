---
comet_change: setup-project-skeleton
role: technical-design
canonical_spec: openspec
---

# Design Doc: setup-project-skeleton

## 目标

建立 memoria 的标准 Python 包骨架（方案 B：接口骨架），为后续 Phase 1 功能模块的实现提供结构基础和接口契约。

## 骨架深度决策

采用**接口骨架**而非纯空文件，理由是：

- `config.py` 和 `models/` 是纯数据结构，无业务逻辑，提前实现不引入过度设计风险
- 各模块函数签名（含 type hints + `NotImplementedError`）确立了接口契约，使后续每个功能 change 变成"填空"而非"从零设计"
- CLI stub 完整展示命令树，`memoria --help` 能直观反映项目结构

## 各文件内容规范

### `memoria/config.py` — 完整实现

使用 `pydantic-settings` 从 `.env` 读取配置：

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

### `memoria/models/*.py` — 完整实现（纯数据类）

使用 Pydantic BaseModel 定义实体，无业务逻辑：
- `Bot`：id、name、system_prompt、kb_ids、model_override
- `KnowledgeBase`：id、name、description
- `Document`：id、kb_id、filename、path、chunk_count

### `memoria/core/*.py` — 函数签名骨架

```python
# pipeline.py
def ingest(kb_id: str, path: str | list[str]) -> dict: raise NotImplementedError
def retrieve(kb_id: str, query: str, k: int = 5) -> list[dict]: raise NotImplementedError
def query(bot_id: str, query: str, stream: bool = False) -> dict: raise NotImplementedError
```

chunker.py 和 embedder.py 同理：类定义 + 方法签名 + `raise NotImplementedError`。

### `memoria/storage/*.py` — 类定义骨架

- `base.py`：抽象基类（ABC），定义 VectorStore 接口
- `chroma_store.py`：继承 base，方法均 `raise NotImplementedError`
- `db.py`：SQLAlchemy 元数据 CRUD 类骨架

### `memoria/server/app.py`

```python
from fastapi import FastAPI

def create_app() -> FastAPI:
    app = FastAPI(title="Memoria")
    # 路由注册占位
    return app
```

### `memoria/cli/main.py` — 完整命令树 stub

```python
@click.group()
def cli(): pass

@cli.command()
def serve(): raise NotImplementedError

@cli.group()
def kb(): pass

@kb.command("create")
@click.argument("name")
def kb_create(name): raise NotImplementedError

# bot / ingest / query 同理
```

## 依赖清单（pyproject.toml）

```toml
[project]
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
```

> chromadb 版本迭代快，若 `>=0.5` 与其他依赖冲突，降级到当前最新稳定版。

## 验收标准

| 命令 | 期望结果 |
|------|---------|
| `pip install -e .` | 无报错 |
| `python -c "import memoria"` | 退出码 0，无 ImportError |
| `memoria --help` | 输出含 "Usage:" 的帮助，退出码 0 |
| `pytest` | 退出码 0 或 5（no tests collected），无导入错误 |
