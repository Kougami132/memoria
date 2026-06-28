## MODIFIED Requirements

### Requirement: 文档列表与删除
系统 SHALL 同时支持按 KB 路径和按查询参数两种方式列出文档。

#### MODIFIED Scenario: 列出文档（按 KB 路径）
- **WHEN** GET `/api/knowledge-bases/{kb_id}/documents`
- **THEN** 返回该 KB 下所有文档信息（JSON 数组）

> 原 `GET /api/documents?kb_id={kb_id}` 路由保持兼容，新增等价的 REST 风格路径以匹配前端调用。
