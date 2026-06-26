# kb-management Specification

## Purpose
TBD - created by archiving change implement-phase1-rag-core. Update Purpose after archive.
## Requirements
### Requirement: 知识库 CRUD（REST API）
系统 SHALL 提供 POST/GET/DELETE `/api/knowledge-bases` 端点管理知识库。

#### Scenario: 创建知识库
- **WHEN** POST `/api/knowledge-bases` 传入 `{"name": "简历", "description": "..."}`
- **THEN** 返回 201，含新建 KB 的 `id`、`name`、`description`、`created_at`

#### Scenario: 列出所有知识库
- **WHEN** GET `/api/knowledge-bases`
- **THEN** 返回 200，含所有 KB 的列表

#### Scenario: 获取知识库详情
- **WHEN** GET `/api/knowledge-bases/{kb_id}`
- **THEN** 返回 200，含该 KB 信息及其文档列表

#### Scenario: 删除知识库
- **WHEN** DELETE `/api/knowledge-bases/{kb_id}`
- **THEN** 返回 204，SQLite 中的 KB 记录和 Chroma collection 均被删除

#### Scenario: 删除不存在的知识库
- **WHEN** DELETE `/api/knowledge-bases/nonexistent`
- **THEN** 返回 404

### Requirement: 知识库 CRUD（CLI）
系统 SHALL 提供 `memoria kb create/list/delete` CLI 命令。

#### Scenario: CLI 创建知识库
- **WHEN** 运行 `memoria kb create "简历"`
- **THEN** 输出新建 KB 的 ID，退出码 0

