## MODIFIED Requirements

### Requirement: 文档上传入库
系统 SHALL 接受 multipart 文件上传，保存到 `upload_dir`，并触发 `ingest()`。vault 来源的文档不可通过此接口上传（source 字段用于区分）。

#### Scenario: 上传 .md 文件
- **WHEN** POST `/api/knowledge-bases/{kb_id}/documents` 上传 .md 文件
- **THEN** 返回 201，文件保存成功，documents 表新增记录（`source: "upload"`），Chroma 完成向量化

#### Scenario: 上传不支持的格式
- **WHEN** POST `/api/knowledge-bases/{kb_id}/documents` 上传 .pdf 文件
- **THEN** 返回 422，提示不支持该文件格式

#### Scenario: 上传到不存在的知识库
- **WHEN** POST `/api/knowledge-bases/nonexistent/documents` 上传文件
- **THEN** 返回 404

### Requirement: 文档列表与删除
系统 SHALL 同时支持按 KB 路径和按查询参数两种方式列出文档；vault 来源文档不允许手动删除。

#### Scenario: 列出文档（按 KB 路径）
- **WHEN** GET `/api/knowledge-bases/{kb_id}/documents`
- **THEN** 返回该 KB 下所有文档信息（JSON 数组），每个文档包含 `source` 字段（`"upload"` 或 `"vault"`）

#### Scenario: 列出文档（按查询参数）
- **WHEN** GET `/api/documents?kb_id={kb_id}`
- **THEN** 返回该 KB 下所有文档信息

#### Scenario: 删除手动上传文档
- **WHEN** DELETE `/api/documents/{doc_id}` 且该文档 source 为 `"upload"`
- **THEN** 返回 204，documents 表记录和 Chroma 中对应的 chunk 向量均被删除

#### Scenario: 删除 vault 来源文档
- **WHEN** DELETE `/api/documents/{doc_id}` 且该文档 source 为 `"vault"`
- **THEN** 返回 409，提示 vault 来源文档不可手动删除，需通过解绑 vault 操作
