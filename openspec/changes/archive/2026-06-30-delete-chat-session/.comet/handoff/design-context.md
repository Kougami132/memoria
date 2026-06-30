# Comet Design Handoff

- Change: delete-chat-session
- Phase: design
- Mode: compact
- Context hash: 2e97b5ff4114041ebc50a8c89479d3f4d1b1ecbf8396bd50aa2560e4fc7334c6

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/delete-chat-session/proposal.md

- Source: openspec/changes/delete-chat-session/proposal.md
- Lines: 1-26
- SHA256: 3a7ff16921698488c68a033346f1084a2798cbf41d40dde8a6081317f72aff2a

```md
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
```

## openspec/changes/delete-chat-session/design.md

- Source: openspec/changes/delete-chat-session/design.md
- Lines: 1-31
- SHA256: e658761c8ef2c8b6dbb21681016798290452779351ea7d2aafd9aab2272e2624

```md
## Context

The chat page lists historical sessions in the left sidebar but provides no way to remove them. Sessions and messages are stored in SQLite via SQLAlchemy. The DB layer already has a pattern for cascade-deleting child rows (see `delete_bot`).

## Goals / Non-Goals

**Goals:**
- Add a single-session delete capability end-to-end (DB → API → UI)
- Cascade-delete all messages belonging to the deleted session

**Non-Goals:**
- Bulk delete / clear all sessions
- Session rename or any other session management

## Decisions

**Cascade in application layer, not DB foreign key**
SQLite supports `ON DELETE CASCADE` but the existing codebase consistently handles cascades in Python (see `delete_bot`, `delete_kb`). We follow the same pattern to stay consistent and avoid a schema migration.

**204 No Content response**
DELETE endpoints return 204 with no body — consistent with REST convention and what the frontend expects (no response body to parse).

**Frontend: transition to blank state on active-session delete**
`newSession()` already exists in `Chat.tsx` and resets `sessionId` to `null` and clears `messages`. Reusing it avoids duplicating state-reset logic.

**No confirmation dialog**
The UX request (requirement 2) explicitly says "直接进入新建对话的状态即可" — no extra modal needed. The delete button is hidden until hover to prevent accidental clicks.

## Risks / Trade-offs

- [No undo] Deletion is permanent → Mitigation: hover-only button reduces accidental clicks; scope is personal chat history with low recovery need.
```

## openspec/changes/delete-chat-session/tasks.md

- Source: openspec/changes/delete-chat-session/tasks.md
- Lines: 1-10
- SHA256: 51ff5afeab46bc97733f4dfe3ce37f6cfef7fb94ec487af7d333670cec0fe237

```md
## 1. 后端

- [ ] 1.1 在 `memoria/storage/db.py` 中新增 `delete_session()` 方法，级联删除 messages
- [ ] 1.2 在 `memoria/server/routes/sessions.py` 中新增 `DELETE /{session_id}` 端点，返回 204

## 2. 前端

- [ ] 2.1 在 `web/src/api.ts` 中新增 `deleteSession()` 函数
- [ ] 2.2 在 `web/src/pages/Chat.tsx` 中添加删除 mutation 和会话列表删除按钮（hover 显示）
- [ ] 2.3 删除当前活跃会话时调用 `newSession()` 重置为空白状态
```

## openspec/changes/delete-chat-session/specs/session-deletion/spec.md

- Source: openspec/changes/delete-chat-session/specs/session-deletion/spec.md
- Lines: 1-18
- SHA256: 87976e39558193ee23f641cef5fa7deb7a7604e120f00e099cd2d1b800193947

```md
## ADDED Requirements

### Requirement: User can delete a single chat session
The system SHALL allow a user to delete any individual chat session and all its associated messages.

#### Scenario: Delete non-active session
- **WHEN** user clicks the delete button on a session that is not currently active
- **THEN** the session and all its messages are removed from the database
- **THEN** the session disappears from the list without affecting the currently displayed conversation

#### Scenario: Delete active session
- **WHEN** user clicks the delete button on the session currently being viewed
- **THEN** the session and all its messages are removed from the database
- **THEN** the UI transitions to the new-conversation blank state (no session selected, empty message list)

#### Scenario: Delete non-existent session
- **WHEN** a DELETE request is made for a session_id that does not exist
- **THEN** the server SHALL return 404
```

