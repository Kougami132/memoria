## ADDED Requirements

### Requirement: Bot CRUD（REST API）
系统 SHALL 提供完整的 Bot 管理端点，支持创建、查询、更新、删除，以及关联多个 KB。

#### Scenario: 创建 Bot
- **WHEN** POST `/api/bots` 传入 `{"name": "面试助手", "system_prompt": "...", "kb_ids": ["kb_1"]}`
- **THEN** 返回 201，含 Bot 完整信息及关联的 kb_ids

#### Scenario: 更新 Bot
- **WHEN** PUT `/api/bots/{bot_id}` 传入新的 `system_prompt` 或 `kb_ids`
- **THEN** 返回 200，Bot 信息更新，bot_kb_links 表同步更新

#### Scenario: 删除 Bot
- **WHEN** DELETE `/api/bots/{bot_id}`
- **THEN** 返回 204，Bot 及其 KB 关联关系从 SQLite 中删除

#### Scenario: 获取不存在的 Bot
- **WHEN** GET `/api/bots/nonexistent`
- **THEN** 返回 404

### Requirement: Bot CRUD（CLI）
系统 SHALL 提供 `memoria bot create/list/delete` CLI 命令。

#### Scenario: CLI 列出 Bot
- **WHEN** 运行 `memoria bot list`
- **THEN** 以表格形式输出所有 Bot，退出码 0
