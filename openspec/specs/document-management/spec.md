# document-management Specification

## Purpose
TBD - created by archiving change implement-phase1-rag-core. Update Purpose after archive.
## Requirements
### Requirement: 文档上传入库
系统 SHALL 接受 multipart 文件上传，保存到 `upload_dir`，并触发 `ingest()`。

#### Scenario: 上传 .md 文件
- **WHEN** POST `/api/knowledge-bases/{kb_id}/documents` 上传 .md 文件
- **THEN** 返回 201，文件保存成功，documents 表新增记录，Chroma 完成向量化

#### Scenario: 上传不支持的格式
- **WHEN** POST `/api/knowledge-bases/{kb_id}/documents` 上传 .pdf 文件
- **THEN** 返回 422，提示不支持该文件格式

#### Scenario: 上传到不存在的知识库
- **WHEN** POST `/api/knowledge-bases/nonexistent/documents` 上传文件
- **THEN** 返回 404

### Requirement: 文档列表与删除
系统 SHALL 同时支持按 KB 路径和按查询参数两种方式列出文档。

#### Scenario: 列出文档（按 KB 路径）
- **WHEN** GET `/api/knowledge-bases/{kb_id}/documents`
- **THEN** 返回该 KB 下所有文档信息（JSON 数组）

#### Scenario: 列出文档（按查询参数）
- **WHEN** GET `/api/documents?kb_id={kb_id}`
- **THEN** 返回该 KB 下所有文档信息

#### Scenario: 删除文档
- **WHEN** DELETE `/api/documents/{doc_id}`
- **THEN** 返回 204，documents 表记录和 Chroma 中对应的 chunk 向量均被删除

