## ADDED Requirements

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
