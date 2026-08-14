# Design: 独立 Agentic RAG 页面

## 总体方案

将 Agentic RAG 从 Bot-scoped sidecar 改为 application-scoped feature：后端新增不带 `bot_id` 的 Agentic API，前端新增独立 `AgenticChat` 页面，经典 `Chat` 页面只保留 Bot Chat。

## 后端

### 会话模型

采用兼容性最小的 sessions 扩展：

- `SessionRow.bot_id` 改为 nullable。
- 增加 `SessionRow.session_type`，默认 `bot`。
- `DB.__init__` 使用现有 inline schema migration 检测并补充 `session_type`；旧数据库中的所有已有会话归类为 `bot`。
- `_session_dict` 返回 `session_type`，保留 `bot_id` 字段以兼容已有前端/接口。Agentic 会话返回 `bot_id: null`。
- 新增 `create_agentic_session`、`list_agentic_sessions`、`get_agentic_session` 或等价查询方法。
- `get_messages_all` 等通用接口仍可读取会话，但 Agentic route 使用专用 session 校验函数，防止 Bot 与 Agentic 会话交叉使用。

### Agentic Engine

将 `AgenticRagEngine.run` 改为接收 `session_id`，不再要求 `bot_id`。

- 获取所有 `db.list_kbs()` 的 ID。
- 使用全局有效 settings 的 `llm_model`，不使用 Bot model override/system prompt。
- Agent instructions 使用全局 system prompt，并明确 Agent 可在所有知识库中选择。
- 首期保留同步 Runner 和非流式 route。
- Agentic 请求成功后写入独立 Agentic session 的 user/assistant messages。

考虑保留旧 `/api/bots/{bot_id}/agent-chat` 作为短期兼容入口，但前端不再使用；若保留，必须继续严格使用 Bot KB scope，避免语义混淆，并在测试中标明 legacy。更干净的方案是删除 route 与旧测试，并迁移测试到新 endpoint。

### API 路由

新增 `memoria/server/routes/agentic.py` 或重构现有 `agent_chat.py`：

- `POST /agent-chat`
- `GET /agent-sessions`
- `GET /agent-sessions/{session_id}/messages`
- `PATCH /agent-sessions/{session_id}`
- `DELETE /agent-sessions/{session_id}`

错误映射沿用项目规范：空消息/不存在会话使用 404/400 的既有约定，SDK/API 连接错误映射 503/502。

## 前端

### 路由与导航

- `App.tsx` 注册 `/agentic-chat`。
- `Layout.tsx` 增加 Agentic RAG 导航项。
- 新建 `pages/AgenticChat.tsx`，复用 Chat 页面中的 Markdown、消息气泡、来源列表和会话管理模式；不复制 Bot 选择与经典 stream 逻辑。
- `Chat.tsx` 删除 mode 状态、Agent mutation、Agentic UI，并恢复发送状态只绑定 classic mutation。

### API 层

- 保留 `chat` 与 `chatStream`。
- 添加 `AgentSession`/`AgentChatResponse` 类型。
- 添加 `agentChat`、`listAgentSessions`、`getAgentMessages`、`updateAgentSession`、`deleteAgentSession`。
- 前端不直接使用 fetch。

## 数据与迁移风险

- SQLite inline migration 必须兼容已有数据库；不要依赖 Alembic。
- 删除 Bot 时，已有经典会话的外键行为需保持现状；Agentic session 的 `bot_id=NULL` 不应影响 Bot 删除。
- session API 返回新增字段不应破坏已有前端。
- 后端 tests 应覆盖旧 schema/新 schema 的 session_type 默认行为（如现有测试结构允许）。

## 测试策略

- Engine unit tests：all-KB scope、跨 Bot 未绑定 KB 可检索、Agentic session reuse/isolation。
- Route tests：Agentic endpoints CRUD；Agentic session 不能传给 classic bot route，反之亦然。
- Regression：现有 classic chat tests unchanged.
- Frontend：TypeScript build/lint；若无组件测试框架，依赖 API contract 与 build 验证。
