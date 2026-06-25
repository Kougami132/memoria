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
