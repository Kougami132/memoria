## ADDED Requirements

### Requirement: 会话列表查询
系统 SHALL 支持按 bot_id 查询该 Bot 下的所有会话，DB 层提供 `list_sessions(bot_id)` 方法。

#### Scenario: 查询指定 Bot 的会话
- **WHEN** 调用 `db.list_sessions(bot_id)`
- **THEN** 返回该 Bot 的所有 session 列表，按 created_at 倒序

### Requirement: 会话消息全量查询
系统 SHALL 提供 `GET /api/sessions/{session_id}/messages` 接口，返回该会话的全量消息，供前端切换会话时加载历史并继续对话。

#### Scenario: 正常返回全量消息
- **WHEN** GET `/api/sessions/{session_id}/messages`
- **THEN** 返回该 session 的所有消息，按 created_at 升序，每项含 `role`、`content`、`created_at`

#### Scenario: 会话不存在时返回 404
- **WHEN** GET `/api/sessions/{non_existent_id}/messages`
- **THEN** 返回 HTTP 404
