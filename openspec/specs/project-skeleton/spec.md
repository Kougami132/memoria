# project-skeleton Specification

## Purpose
TBD - created by archiving change setup-project-skeleton. Update Purpose after archive.
## Requirements
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
项目 SHALL 提供 `.env.example` 文件，包含所有必要的配置项占位符，且不含真实密钥。新增 `USE_MOCK` 配置项。

#### Scenario: 配置模板完整性
- **WHEN** 用户查看 `.env.example`
- **THEN** 文件包含 NEWAPI_BASE_URL、NEWAPI_API_KEY、EMBEDDING_MODEL、LLM_MODEL、CHUNK_SIZE、CHUNK_OVERLAP、TOP_K、DB_PATH、CHROMA_PATH、UPLOAD_DIR、USE_MOCK 等配置项

### Requirement: 敏感文件不进版本控制
`.gitignore` SHALL 排除 `.env`、`data/`、`__pycache__/`、`.venv/`、`*.pyc`、`.pytest_cache/`。

#### Scenario: gitignore 覆盖敏感路径
- **WHEN** 用户在包含 `.env` 和 `data/` 目录的项目中运行 `git status`
- **THEN** `.env` 和 `data/` 不出现在未跟踪文件列表中

