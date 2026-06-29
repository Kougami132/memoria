## MODIFIED Requirements

### Requirement: 知识库 CRUD（REST API）
系统 SHALL 提供 POST/GET/DELETE `/api/knowledge-bases` 端点管理知识库。

#### Scenario: 创建知识库
- **WHEN** POST `/api/knowledge-bases` 传入 `{"name": "简历", "description": "..."}`
- **THEN** 返回 201，含新建 KB 的 `id`、`name`、`description`、`created_at`

#### Scenario: 列出所有知识库
- **WHEN** GET `/api/knowledge-bases`
- **THEN** 返回 200，含所有 KB 的列表，每个 KB 包含 `vault`（绑定的 vault 摘要或 null）

#### Scenario: 获取知识库详情
- **WHEN** GET `/api/knowledge-bases/{kb_id}`
- **THEN** 返回 200，含该 KB 信息、文档列表，以及绑定的 vault 信息（含 `type`、`last_synced_at`，密码屏蔽）

#### Scenario: 删除知识库
- **WHEN** DELETE `/api/knowledge-bases/{kb_id}`
- **THEN** 返回 204，SQLite 中的 KB 记录、关联 vault、vault_files、documents 和 Chroma collection 均被删除

#### Scenario: 删除不存在的知识库
- **WHEN** DELETE `/api/knowledge-bases/nonexistent`
- **THEN** 返回 404
