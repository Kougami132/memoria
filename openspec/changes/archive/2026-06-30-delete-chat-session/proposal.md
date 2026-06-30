## Why

聊天页面的会话列表只能新建，无法删除历史会话，积累旧会话后无法清理，影响使用体验。

## What Changes

- 新增 `DELETE /sessions/{session_id}` REST 端点，级联删除该会话的所有消息
- `DB` 层新增 `delete_session()` 方法
- 前端 API client 新增 `deleteSession()`
- `Chat.tsx` 会话列表每条加删除按钮，删除当前活跃会话后自动进入新建对话空白状态

## Capabilities

### New Capabilities

- `session-deletion`: 用户可删除单个聊天会话及其所有消息记录

### Modified Capabilities

（无）

## Impact

- **后端**：`memoria/storage/db.py`、`memoria/server/routes/sessions.py`
- **前端**：`web/src/api.ts`、`web/src/pages/Chat.tsx`
- **数据库**：纯删除操作，无 schema 变更
