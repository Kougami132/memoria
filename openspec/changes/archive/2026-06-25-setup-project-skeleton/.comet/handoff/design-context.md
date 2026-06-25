# Comet Design Handoff

- Change: setup-project-skeleton
- Phase: design
- Mode: compact
- Context hash: 305f7777de28525f1641abd28f61b4866da3d91d1b7ea685639d2f497211a96b

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/setup-project-skeleton/proposal.md

- Source: openspec/changes/setup-project-skeleton/proposal.md
- Lines: 1-29
- SHA256: 96c6ce5c787a9b6b23feef2006decd4003b634ce479547eb8ad92e9dae1440d4

```md
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
```

## openspec/changes/setup-project-skeleton/design.md

- Source: openspec/changes/setup-project-skeleton/design.md
- Lines: 1-47
- SHA256: 28d67df86b270221be1049293dffbb211a5c4692e8eecc4ba11ca71765992ad2

```md
## Context

项目目前只有 DESIGN.md 和两个实验脚本，尚无可安装的 Python 包。需要在实现任何功能前建立标准的包骨架，确保后续每个功能模块都有规范的落地位置。

## Goals / Non-Goals

**Goals:**
- 建立标准 Python 包结构，支持开发模式安装（`pip install -e .`）
- 提供完整的依赖声明（Phase 1 所需的全部第三方库）
- 配置模板和 gitignore 保护敏感数据不进入版本控制
- 测试框架就绪，后续可直接编写测试

**Non-Goals:**
- 不实现任何功能逻辑（所有 `.py` 文件内容为空或 `pass`）
- 不配置 CI/CD、Docker、pre-commit 等工程化工具
- 不处理实验脚本（`rag_mini.py`、`react_mini.py` 原地保留）

## Decisions

### 依赖管理：uv + pyproject.toml（PEP 621）

选择 uv 作为包管理工具，pyproject.toml 遵循 PEP 621 标准。
- 理由：uv 安装速度极快，兼容标准 pyproject.toml，即便用户未安装 uv 也可直接用 `pip install -e .`
- 替代方案：poetry（配置稍繁琐）、pipenv（已式微）

### Python 版本：3.11+

- 理由：3.11 有显著性能提升，type hints 更完善；主要依赖（chromadb、fastapi、openai SDK）均已稳定支持 3.11
- 3.12 也可用，但部分依赖兼容性仍在追赶，暂不强制

### CLI 框架：Click

- 理由：DESIGN.md 设计了 `memoria serve / kb / bot / ingest / query` 等子命令，Click 的命令组模式最自然；FastAPI 项目生态中 Click 是惯用选择
- 替代方案：Typer（基于 Click，但骨架阶段 stub 化无差别）

### 测试框架：pytest + pytest-asyncio

- 理由：DESIGN.md 有异步 FastAPI 路由，需要 pytest-asyncio 支持；pytest 是 Python 事实标准

### 目录结构：完全按 DESIGN.md 第七节

不做任何结构调整，严格遵循设计文档，降低认知切换成本。

## Risks / Trade-offs

- [依赖版本锁定] chromadb 版本迭代较快，`^0.5.0` 可能在 uv lock 时与其他依赖冲突 → 初始安装失败时降级到最新稳定版
- [骨架文件为空] `pass` 占位会导致 `memoria --help` 只显示根命令，无子命令 → 可接受，Phase 1 功能实现 change 会逐步填充
```

## openspec/changes/setup-project-skeleton/tasks.md

- Source: openspec/changes/setup-project-skeleton/tasks.md
- Lines: 1-29
- SHA256: 82a92c07e4e63f03679b99e8f50e01d288ac78516754b4eac81f880f00cc0881

```md
## 1. 项目配置文件

- [ ] 1.1 创建 `pyproject.toml`（项目元数据、Python 3.11+、Phase 1 全部依赖、pytest 配置、click entrypoint）
- [ ] 1.2 创建 `.env.example`（含 NEWAPI_BASE_URL、NEWAPI_API_KEY、EMBEDDING_MODEL、LLM_MODEL、CHUNK_SIZE、CHUNK_OVERLAP、TOP_K、DB_PATH、CHROMA_PATH、UPLOAD_DIR）
- [ ] 1.3 创建 `.gitignore`（排除 .env、data/、__pycache__/、.venv/、*.pyc、.pytest_cache/、dist/）

## 2. Python 包目录结构

- [ ] 2.1 创建 `memoria/__init__.py`
- [ ] 2.2 创建 `memoria/config.py`（stub，从 .env 读取配置的占位）
- [ ] 2.3 创建 `memoria/core/__init__.py`、`pipeline.py`、`chunker.py`、`embedder.py`（均为 stub）
- [ ] 2.4 创建 `memoria/storage/__init__.py`、`base.py`、`chroma_store.py`、`db.py`（均为 stub）
- [ ] 2.5 创建 `memoria/models/__init__.py`、`bot.py`、`knowledge_base.py`、`document.py`（均为 stub）
- [ ] 2.6 创建 `memoria/llm/__init__.py`、`caller.py`（均为 stub）
- [ ] 2.7 创建 `memoria/server/__init__.py`、`app.py`、`deps.py` 和 `routes/` 子包（`__init__.py`、`knowledge_bases.py`、`bots.py`、`documents.py`、`chat.py`，均为 stub）
- [ ] 2.8 创建 `memoria/cli/__init__.py`、`main.py`（含最小 Click group，`memoria --help` 可运行）

## 3. 测试与文档

- [ ] 3.1 创建 `tests/conftest.py`（空文件）
- [ ] 3.2 创建 `tests/test_placeholder.py`（一个 pass 级别的占位测试，确保 pytest 可运行）
- [ ] 3.3 创建 `README.md`（安装步骤、`memoria --help` 示例、开发环境搭建说明）

## 4. 验收验证

- [ ] 4.1 运行 `pip install -e .` 确认安装无报错
- [ ] 4.2 运行 `python -c "import memoria"` 确认无 ImportError
- [ ] 4.3 运行 `memoria --help` 确认 CLI 可运行
- [ ] 4.4 运行 `pytest` 确认测试套件可启动
```

## openspec/changes/setup-project-skeleton/specs/project-skeleton/spec.md

- Source: openspec/changes/setup-project-skeleton/specs/project-skeleton/spec.md
- Lines: 1-43
- SHA256: 0129c05608d0dd4266e0c2f222370c2ef20cc82c120328a7574636ab2fb52f8f

```md
## ADDED Requirements

### Requirement: 可安装的 Python 包
项目 SHALL 提供标准 `pyproject.toml`，使 `pip install -e .` 和 `uv pip install -e .` 均可成功完成开发模式安装。

#### Scenario: 开发模式安装成功
- **WHEN** 用户在项目根目录运行 `pip install -e .`
- **THEN** 安装过程无报错，`memoria` 命令出现在 PATH 中

### Requirement: 包可导入
安装后，`import memoria` SHALL 无报错执行。

#### Scenario: 基础导入
- **WHEN** 用户在任意目录运行 `python -c "import memoria"`
- **THEN** 命令以退出码 0 完成，无 ImportError 或 ModuleNotFoundError

### Requirement: CLI 入口可运行
`memoria --help` SHALL 输出帮助信息并以退出码 0 退出。

#### Scenario: CLI 帮助
- **WHEN** 用户运行 `memoria --help`
- **THEN** 输出包含 "Usage:" 的帮助文本，退出码为 0

### Requirement: 测试套件可运行
`pytest` SHALL 在项目根目录可运行，即使没有任何测试用例也不应 crash。

#### Scenario: 空测试套件
- **WHEN** 用户在项目根目录运行 `pytest`
- **THEN** pytest 以退出码 0 或 5（no tests collected）退出，不抛出导入错误

### Requirement: 配置模板存在
项目 SHALL 提供 `.env.example` 文件，包含所有必要的配置项占位符，且不含真实密钥。

#### Scenario: 配置模板完整性
- **WHEN** 用户查看 `.env.example`
- **THEN** 文件包含 NEWAPI_BASE_URL、NEWAPI_API_KEY、EMBEDDING_MODEL、LLM_MODEL、CHUNK_SIZE、CHUNK_OVERLAP、TOP_K、DB_PATH、CHROMA_PATH、UPLOAD_DIR 等配置项

### Requirement: 敏感文件不进版本控制
`.gitignore` SHALL 排除 `.env`、`data/`、`__pycache__/`、`.venv/`、`*.pyc`、`.pytest_cache/`。

#### Scenario: gitignore 覆盖敏感路径
- **WHEN** 用户在包含 `.env` 和 `data/` 目录的项目中运行 `git status`
- **THEN** `.env` 和 `data/` 不出现在未跟踪文件列表中
```

