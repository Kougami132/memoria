---
comet_change: delete-chat-session
role: technical-design
canonical_spec: openspec
---

## Context

聊天页面左侧会话列表只能新建会话，无法删除历史会话。随着使用积累，旧会话无法清理，影响体验。Sessions 和 messages 存储于 SQLite，通过 SQLAlchemy ORM 管理。DB 层已有成熟的应用层级联删除模式（`delete_bot`、`delete_kb`）。

## Goals / Non-Goals

**Goals:**
- 支持用户删除单个聊天会话及其所有消息
- 删除当前活跃会话时自动切换到新建对话空白状态

**Non-Goals:**
- 批量删除 / 清空全部会话
- 会话重命名或其他管理操作
- 撤销删除

## Architecture

```
前端 Chat.tsx
  hover 显示 Trash2 按钮
        │
        ▼
  deleteSessionMutation
  (useMutation → api.deleteSession)
        │
        ▼
  DELETE /sessions/{session_id}       → 204 No Content
                                      → 404 if not found
        │
        ▼
  DB.delete_session(session_id)
    DELETE messages WHERE session_id = ?
    DELETE sessions WHERE id = ?
```

## Decisions

**应用层级联，不用 DB 外键 CASCADE**
与 `delete_bot`（`db.py:~215`）保持一致，避免 schema 迁移，代码路径可读。

**DELETE 返回 204 No Content**
REST 惯例，前端无需解析响应体。

**删除活跃会话复用 `newSession()`**
`Chat.tsx` 已有 `newSession()` 函数负责重置 `sessionId → null` 和清空 `messages`，直接复用避免重复状态逻辑。

**无确认弹窗，hover-only 按钮**
用户明确要求"直接进入新建对话状态"，hover 显示防止误触已足够。

## Risks / Trade-offs

- [永久删除，无 undo] → hover-only 按钮降低误触概率；个人聊天历史恢复需求低，可接受

## Implementation Touchpoints

| 文件 | 变更 |
|------|------|
| `memoria/storage/db.py` | 新增 `delete_session()` |
| `memoria/server/routes/sessions.py` | 新增 `DELETE /{session_id}` 端点 |
| `web/src/api.ts` | 新增 `deleteSession()` |
| `web/src/pages/Chat.tsx` | 删除按钮 + mutation + 活跃会话重置 |
