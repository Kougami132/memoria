# rag-ingest Specification

## Purpose
TBD - created by archiving change implement-phase1-rag-core. Update Purpose after archive.
## Requirements
### Requirement: 文件读取与切分
系统 SHALL 读取 `.md` 和 `.txt` 文件，使用 RecursiveCharacterTextSplitter 按 `chunk_size` 和 `chunk_overlap` 切分为文本片段。

#### Scenario: 成功 ingest .md 文件
- **WHEN** 调用 `ingest(kb_id, "doc.md")` 且文件存在
- **THEN** 文件被读取、切分为若干 chunk，每个 chunk 被向量化并写入对应 ChromaDB collection，返回含 chunk_count 的结果

#### Scenario: 成功 ingest .txt 文件
- **WHEN** 调用 `ingest(kb_id, "doc.txt")` 且文件存在
- **THEN** 流程与 .md 相同，正常完成

#### Scenario: 不支持的文件格式
- **WHEN** 调用 `ingest(kb_id, "doc.pdf")`
- **THEN** 抛出 ValueError，提示不支持该格式

#### Scenario: 文件不存在
- **WHEN** 调用 `ingest(kb_id, "nonexistent.md")`
- **THEN** 抛出 FileNotFoundError

### Requirement: 文档元数据持久化
ingest 完成后，系统 SHALL 在 SQLite `documents` 表中写入文档记录，包含 `kb_id`、`filename`、`path`、`chunk_count`。

#### Scenario: 元数据写入成功
- **WHEN** `ingest()` 成功完成
- **THEN** `documents` 表中存在对应记录，`chunk_count` 等于实际切分数量

