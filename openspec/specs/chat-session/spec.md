# chat-session Specification

## Purpose
TBD - created by archiving change implement-phase1-rag-core. Update Purpose after archive.
## Requirements
### Requirement: Session 创建
系统 SHALL 在首次对话时自动创建 session，返回 `session_id`，后续请求可用该 ID 续聊。

#### Scenario: 新对话自动创建 session
- **WHEN** POST `/api/chat/{bot_id}` 不传 `session_id`
- **THEN** 系统创建新 session，响应包含新生成的 `session_id`

#### Scenario: 续聊使用已有 session
- **WHEN** POST `/api/chat/{bot_id}` 传入已存在的 `session_id`
- **THEN** 系统加载该 session 的历史消息，拼入 prompt，回答基于上下文

#### Scenario: 不存在的 session_id
- **WHEN** POST `/api/chat/{bot_id}` 传入不存在的 `session_id`
- **THEN** 返回 404，提示 session 不存在

### Requirement: 消息历史持久化
系统 SHALL 将每轮对话的 user 消息和 assistant 回答存入 SQLite `messages` 表。

#### Scenario: 消息写入
- **WHEN** 一轮对话完成
- **THEN** `messages` 表新增 2 条记录：role=user 和 role=assistant，均关联正确的 session_id

### Requirement: 历史消息截断
系统 SHALL 最多取最近 10 条历史消息拼入 prompt，避免超出 LLM context 限制。

#### Scenario: 超长历史截断
- **WHEN** session 已有 20 条消息，发起新对话
- **THEN** 只有最近 10 条历史消息出现在 LLM 的 messages 列表中

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

