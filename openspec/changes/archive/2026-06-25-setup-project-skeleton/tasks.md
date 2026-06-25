## 1. 项目配置文件

- [x] 1.1 创建 `pyproject.toml`（项目元数据、Python 3.11+、Phase 1 全部依赖、pytest 配置、click entrypoint）
- [x] 1.2 创建 `.env.example`（含 NEWAPI_BASE_URL、NEWAPI_API_KEY、EMBEDDING_MODEL、LLM_MODEL、CHUNK_SIZE、CHUNK_OVERLAP、TOP_K、DB_PATH、CHROMA_PATH、UPLOAD_DIR）
- [x] 1.3 创建 `.gitignore`（排除 .env、data/、__pycache__/、.venv/、*.pyc、.pytest_cache/、dist/）

## 2. Python 包目录结构

- [x] 2.1 创建 `memoria/__init__.py`
- [x] 2.2 创建 `memoria/config.py`（stub，从 .env 读取配置的占位）
- [x] 2.3 创建 `memoria/core/__init__.py`、`pipeline.py`、`chunker.py`、`embedder.py`（均为 stub）
- [x] 2.4 创建 `memoria/storage/__init__.py`、`base.py`、`chroma_store.py`、`db.py`（均为 stub）
- [x] 2.5 创建 `memoria/models/__init__.py`、`bot.py`、`knowledge_base.py`、`document.py`（均为 stub）
- [x] 2.6 创建 `memoria/llm/__init__.py`、`caller.py`（均为 stub）
- [x] 2.7 创建 `memoria/server/__init__.py`、`app.py`、`deps.py` 和 `routes/` 子包（`__init__.py`、`knowledge_bases.py`、`bots.py`、`documents.py`、`chat.py`，均为 stub）
- [x] 2.8 创建 `memoria/cli/__init__.py`、`main.py`（含最小 Click group，`memoria --help` 可运行）

## 3. 测试与文档

- [x] 3.1 创建 `tests/conftest.py`（空文件）
- [x] 3.2 创建 `tests/test_placeholder.py`（一个 pass 级别的占位测试，确保 pytest 可运行）
- [x] 3.3 创建 `README.md`（安装步骤、`memoria --help` 示例、开发环境搭建说明）

## 4. 验收验证

- [x] 4.1 运行 `pip install -e .` 确认安装无报错
- [x] 4.2 运行 `python -c "import memoria"` 确认无 ImportError
- [x] 4.3 运行 `memoria --help` 确认 CLI 可运行
- [x] 4.4 运行 `pytest` 确认测试套件可启动
