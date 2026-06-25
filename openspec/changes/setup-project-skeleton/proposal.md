## Why

memoria 目前只有设计文档（DESIGN.md）和两个实验性脚本，缺乏可安装、可测试的标准 Python 包结构。在开始实现任何功能模块之前，需要先建立正确的项目骨架作为后续所有开发的基础。

## What Changes

- 创建 `memoria/` Python 包，含完整子包结构（core / storage / models / llm / server / cli）
- 创建 `pyproject.toml`，定义项目元数据、依赖和构建配置（使用 uv，Python 3.11+）
- 创建 `.env.example`，提供标准配置模板（API Key、模型名、存储路径等）
- 创建 `.gitignore`，排除 `data/`、`.env`、`__pycache__`、`.venv` 等
- 创建 `README.md`，提供安装和基础运行说明
- 创建 `tests/` 目录骨架，含 `conftest.py`

## Capabilities

### New Capabilities

- `project-skeleton`: 可安装的 Python 包骨架，支持 `pip install -e .`、`import memoria`、`memoria --help`、`pytest` 基础运行

### Modified Capabilities

（无现有规格需修改）

## Impact

- 影响代码：新建所有骨架文件，不修改现有 `rag_mini.py` / `react_mini.py`
- 依赖引入：fastapi、uvicorn、chromadb、openai、langchain-text-splitters、python-dotenv、sqlalchemy、pydantic、click（均为 Phase 1 所需）
- 开发依赖：pytest、pytest-asyncio、black、ruff
- 无 API 变更，无数据库 schema 变更
