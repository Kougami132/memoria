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
