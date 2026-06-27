## ADDED Requirements

### Requirement: 按 Bot 列出会话
系统 SHALL 提供 `GET /api/bots/{bot_id}/sessions` 接口，返回该 Bot 下的所有会话列表，按创建时间倒序。

#### Scenario: 正常返回会话列表
- **WHEN** GET `/api/bots/{bot_id}/sessions`
- **THEN** 返回数组，每项含 `id`、`bot_id`、`created_at`，按 created_at 倒序

#### Scenario: Bot 无会话时返回空数组
- **WHEN** Bot 存在但尚未发起任何对话
- **THEN** 返回 `[]`

#### Scenario: Bot 不存在时返回 404
- **WHEN** GET `/api/bots/{non_existent_id}/sessions`
- **THEN** 返回 HTTP 404
