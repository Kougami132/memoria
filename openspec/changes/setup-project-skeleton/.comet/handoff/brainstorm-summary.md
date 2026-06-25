# Brainstorm Summary

- Change: setup-project-skeleton
- Date: 2026-06-25

## 确认的技术方案

**方案 B：接口骨架**

- `config.py`：完整实现（Pydantic Settings 读 .env）
- `models/*.py`：完整实现（纯数据类，无业务逻辑）
- `core/*.py`：函数签名 + type hints + `raise NotImplementedError`
- `storage/*.py`：类定义 + 方法签名 + `raise NotImplementedError`
- `llm/caller.py`：函数签名 + `raise NotImplementedError`
- `server/app.py`：`create_app()` stub，返回 FastAPI 实例
- `cli/main.py`：所有子命令 stub（serve/kb/bot/ingest/query 均有入口但 pass）

其余技术栈决策（已在 proposal/design.md 确认）：
- uv + pyproject.toml (PEP 621)，Python 3.11+
- Click CLI 框架，pytest + pytest-asyncio
- 目录结构严格按 DESIGN.md 第七节

## 关键取舍与风险

- config.py 和 models 提前实现 = 零风险（纯数据结构，无业务逻辑）
- 函数签名确定后续实现的接口契约，减少后续 change 的设计摩擦
- `memoria --help` 能展示完整命令树，项目结构直观可见
- chromadb 依赖版本可能冲突 → 初始安装失败时降级到最新稳定版

## 测试策略

- 骨架阶段只需 `pytest` 可运行（0 测试通过为正常）
- `tests/test_placeholder.py` 放一个 trivial 占位测试
- 后续每个功能 change 负责补充对应模块的测试

## Spec Patch

无需 patch — 当前 spec 已覆盖全部验收场景。
