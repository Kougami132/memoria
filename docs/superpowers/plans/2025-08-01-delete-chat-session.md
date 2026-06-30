---
change: delete-chat-session
design-doc: docs/superpowers/specs/2025-08-01-delete-chat-session-design.md
base-ref: 1e3c61f5b8dde401055161f8c62c905cf9ea08e0
---

# 删除聊天会话 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 允许用户从会话列表中删除单个聊天会话及其所有消息，删除当前活跃会话时自动切换到新建对话空白状态。

**Architecture:** 后端在 `DB` 类新增应用层级联删除方法（先删 messages 再删 session），FastAPI 路由新增 `DELETE /sessions/{session_id}` 端点返回 204；前端 `api.ts` 新增 `deleteSession()` 函数，`Chat.tsx` 在会话列表项 hover 时显示垃圾桶按钮，触发 `useMutation` 并在删除活跃会话时调用现有 `newSession()` 重置状态。

**Tech Stack:** Python 3.11+, FastAPI, SQLAlchemy ORM (SQLite), React 18, TanStack Query v5, lucide-react, TypeScript

## Global Constraints

- 应用层级联删除，不修改 DB schema，无迁移文件
- DELETE 端点返回 204 No Content，session 不存在返回 404
- 删除活跃会话必须复用现有 `newSession()` 函数，不重复实现状态重置
- hover-only 删除按钮，无确认弹窗
- 测试使用项目现有 `TestClient` fixture（见 `tests/test_server.py`），不引入新依赖

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `memoria/storage/db.py` | 修改 | 新增 `delete_session(session_id: str) -> None` |
| `memoria/server/routes/sessions.py` | 修改 | 新增 `DELETE /{session_id}` 端点 |
| `web/src/api.ts` | 修改 | 新增 `deleteSession(id: string): Promise<void>` |
| `web/src/pages/Chat.tsx` | 修改 | 删除按钮 + deleteSessionMutation + 活跃会话重置 |
| `tests/test_server.py` | 修改 | 新增 session 删除端点测试 |
| `tests/test_storage.py` | 修改 | 新增 `delete_session` DB 方法测试 |

---

### Task 1: DB 层 — `delete_session()` 方法

**Files:**
- Modify: `memoria/storage/db.py:295-374`（Sessions & Messages 区块末尾追加）
- Test: `tests/test_storage.py`

**Interfaces:**
- Consumes: 无（内部使用 `SessionRow`, `MessageRow`, `self._s()`）
- Produces: `DB.delete_session(session_id: str) -> None` — session 不存在时静默返回（幂等）

- [x] **Step 1: 在 `tests/test_storage.py` 末尾追加失败测试**

打开 `tests/test_storage.py`，在文件末尾追加：

```python
def test_delete_session_cascades_messages(tmp_path):
    db = DB(str(tmp_path / "test.db"))
    bot = db.create_bot("b")
    session = db.create_session(bot["id"])
    db.add_message(session["id"], "user", "hello")
    db.add_message(session["id"], "assistant", "hi")

    db.delete_session(session["id"])

    assert db.get_session(session["id"]) is None
    assert db.get_messages_all(session["id"]) == []


def test_delete_session_nonexistent_is_noop(tmp_path):
    db = DB(str(tmp_path / "test.db"))
    # 不应抛出异常
    db.delete_session("nonexistent-id")
```

- [x] **Step 2: 运行测试，确认失败**

```bash
cd N:/Data/Projects/memoria
pytest tests/test_storage.py::test_delete_session_cascades_messages tests/test_storage.py::test_delete_session_nonexistent_is_noop -v
```

预期：`FAILED` — `AttributeError: 'DB' object has no attribute 'delete_session'`

- [x] **Step 3: 在 `memoria/storage/db.py` 的 `get_messages_all` 方法之后（约第 374 行）追加实现**

在 `get_messages_all` 方法结束后、`# ── Vaults` 注释之前插入：

```python
    def delete_session(self, session_id: str) -> None:
        with self._s() as s:
            s.query(MessageRow).filter(MessageRow.session_id == session_id).delete()
            row = s.get(SessionRow, session_id)
            if row:
                s.delete(row)
```

- [x] **Step 4: 运行测试，确认通过**

```bash
cd N:/Data/Projects/memoria
pytest tests/test_storage.py::test_delete_session_cascades_messages tests/test_storage.py::test_delete_session_nonexistent_is_noop -v
```

预期：`PASSED PASSED`

- [x] **Step 5: 提交**

```bash
cd N:/Data/Projects/memoria
git add memoria/storage/db.py tests/test_storage.py
git commit -m "feat: DB 层新增 delete_session 级联删除方法"
```

---

### Task 2: 后端路由 — `DELETE /sessions/{session_id}`

**Files:**
- Modify: `memoria/server/routes/sessions.py`（全文替换）
- Test: `tests/test_server.py`

**Interfaces:**
- Consumes: `DB.delete_session(session_id: str) -> None`（Task 1 产出）；`DB.get_session(session_id: str) -> dict | None`（已有）
- Produces: `DELETE /api/sessions/{session_id}` — 存在时返回 `204 No Content`，不存在时返回 `404 {"detail": "Session not found"}`

- [x] **Step 1: 在 `tests/test_server.py` 末尾追加失败测试**

打开 `tests/test_server.py`，在文件末尾追加：

```python
def test_delete_session(client):
    kb = client.post("/api/knowledge-bases", json={"name": "kb", "description": ""}).json()
    bot = client.post("/api/bots", json={"name": "b", "system_prompt": "", "kb_ids": [kb["id"]]}).json()
    chat = client.post(f"/api/chat/{bot['id']}", json={"message": "hello"}).json()
    session_id = chat["session_id"]

    r = client.delete(f"/api/sessions/{session_id}")
    assert r.status_code == 204

    # 再次删除应返回 404
    r2 = client.delete(f"/api/sessions/{session_id}")
    assert r2.status_code == 404


def test_delete_session_not_found(client):
    r = client.delete("/api/sessions/nonexistent")
    assert r.status_code == 404
```

- [x] **Step 2: 运行测试，确认失败**

```bash
cd N:/Data/Projects/memoria
pytest tests/test_server.py::test_delete_session tests/test_server.py::test_delete_session_not_found -v
```

预期：`FAILED` — `405 Method Not Allowed`（端点尚不存在）

- [x] **Step 3: 修改 `memoria/server/routes/sessions.py`，添加 DELETE 端点**

将文件内容替换为：

```python
from fastapi import APIRouter, Depends, HTTPException, Response

from memoria.server.deps import get_db
from memoria.storage.db import DB

router = APIRouter(prefix="/sessions", tags=["sessions"])


@router.get("/{session_id}/messages")
def get_messages(session_id: str, db: DB = Depends(get_db)):
    if db.get_session(session_id) is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return db.get_messages_all(session_id)


@router.delete("/{session_id}", status_code=204)
def delete_session(session_id: str, db: DB = Depends(get_db)):
    if db.get_session(session_id) is None:
        raise HTTPException(status_code=404, detail="Session not found")
    db.delete_session(session_id)
    return Response(status_code=204)
```

- [x] **Step 4: 运行测试，确认通过**

```bash
cd N:/Data/Projects/memoria
pytest tests/test_server.py::test_delete_session tests/test_server.py::test_delete_session_not_found -v
```

预期：`PASSED PASSED`

- [x] **Step 5: 运行全量后端测试，确认无回归**

```bash
cd N:/Data/Projects/memoria
pytest tests/ -v
```

预期：全部 PASSED（或与 base-ref 前相同数量的已知跳过）

- [x] **Step 6: 提交**

```bash
cd N:/Data/Projects/memoria
git add memoria/server/routes/sessions.py tests/test_server.py
git commit -m "feat: 新增 DELETE /sessions/{session_id} 端点，返回 204"
```

---

### Task 3: 前端 API 函数 — `deleteSession()`

**Files:**
- Modify: `web/src/api.ts`（在 `getMessages` 行之后追加一行）

**Interfaces:**
- Consumes: `DELETE /api/sessions/{id}` 端点（Task 2 产出）
- Produces: `deleteSession(id: string): Promise<void>` — 供 `Chat.tsx` 的 `useMutation` 调用

> 注意：前端无独立单元测试框架，此 Task 的验证在 Task 4 的集成验收中完成。

- [x] **Step 1: 修改 `web/src/api.ts`**

在第 73 行 `export const getMessages = ...` 之后插入一行：

```typescript
export const deleteSession = (id: string) => req<void>(`/sessions/${id}`, { method: 'DELETE' })
```

修改后该区块为：

```typescript
export const chat = (botId: string, message: string, sessionId?: string) =>
  req<ChatResponse>(`/chat/${botId}`, { method: 'POST', ...json({ message, session_id: sessionId }) })
export const getMessages = (sessionId: string) => req<Message[]>(`/sessions/${sessionId}/messages`)
export const deleteSession = (id: string) => req<void>(`/sessions/${id}`, { method: 'DELETE' })
```

- [x] **Step 2: 确认 TypeScript 编译无错误**

```bash
cd N:/Data/Projects/memoria/web
npm run build 2>&1 | tail -20
```

预期：`built in` 字样，无 `error TS` 输出

- [x] **Step 3: 提交**

```bash
cd N:/Data/Projects/memoria
git add web/src/api.ts
git commit -m "feat: api.ts 新增 deleteSession 函数"
```

---

### Task 4: 前端 UI — 删除按钮 + Mutation + 活跃会话重置

**Files:**
- Modify: `web/src/pages/Chat.tsx`

**Interfaces:**
- Consumes:
  - `api.deleteSession(id: string): Promise<void>`（Task 3 产出）
  - `newSession(): void`（已有，第 105-109 行）
  - `refetchSessions()`（已有，第 85-89 行的 `useQuery` 返回值）
  - `Trash2` 图标（lucide-react，需加入 import）
- Produces: 会话列表每项 hover 时右侧显示 `Trash2` 按钮；点击后删除该会话；若被删会话为当前活跃会话则调用 `newSession()`

- [x] **Step 1: 修改 `web/src/pages/Chat.tsx` 的 import 行**

将第 7 行从：

```typescript
import { Send, Plus, ChevronDown, ChevronUp, MessageSquare, BookOpen, Brain } from 'lucide-react'
```

改为：

```typescript
import { Send, Plus, ChevronDown, ChevronUp, MessageSquare, BookOpen, Brain, Trash2 } from 'lucide-react'
```

- [x] **Step 2: 在 `sendMsg` mutation 之后（约第 126 行之后）插入 `deleteSessionMutation`**

在 `sendMsg` 的 `useMutation` 代码块结束后、`handleKeyDown` 函数之前插入：

```typescript
  const deleteSessionMutation = useMutation({
    mutationFn: (sid: string) => api.deleteSession(sid),
    onSuccess: (_data, sid) => {
      if (sid === sessionId) newSession()
      refetchSessions()
    },
  })
```

- [x] **Step 3: 修改会话列表项，添加 hover 删除按钮**

将第 158-171 行的 `sessions.map` 内容从：

```typescript
          {sessions.map((s, index) => (
            <button
              key={s.id}
              className={`w-full text-left rounded-xl px-3 py-3 text-xs transition-colors ${
                s.id === sessionId
                  ? 'bg-gradient-to-r from-purple-600/90 to-blue-500/90 text-white shadow-sm'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
              onClick={() => loadSession(s.id)}
            >
              <p className="font-medium truncate">会话 {index + 1}</p>
              <p className="opacity-60 mt-0.5">{s.created_at.slice(0, 16).replace('T', ' ')}</p>
            </button>
          ))}
```

替换为：

```typescript
          {sessions.map((s, index) => (
            <div
              key={s.id}
              className={`group relative w-full rounded-xl text-xs transition-colors ${
                s.id === sessionId
                  ? 'bg-gradient-to-r from-purple-600/90 to-blue-500/90 text-white shadow-sm'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <button
                className="w-full text-left px-3 py-3"
                onClick={() => loadSession(s.id)}
              >
                <p className="font-medium truncate pr-5">会话 {index + 1}</p>
                <p className="opacity-60 mt-0.5">{s.created_at.slice(0, 16).replace('T', ' ')}</p>
              </button>
              <button
                className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-black/10"
                onClick={e => { e.stopPropagation(); deleteSessionMutation.mutate(s.id) }}
                aria-label="删除会话"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
```

- [x] **Step 4: 确认 TypeScript 编译无错误**

```bash
cd N:/Data/Projects/memoria/web
npm run build 2>&1 | tail -20
```

预期：`built in` 字样，无 `error TS` 输出

- [x] **Step 5: 手动验收**

启动后端和前端，在浏览器中验证以下行为：

1. 选择一个机器人，发送消息创建会话 → 左侧出现会话项
2. 将鼠标悬停在会话项上 → 右侧出现垃圾桶图标
3. 点击垃圾桶 → 会话项从列表消失，若该会话为当前活跃会话则主区域变为空白新建状态
4. 点击垃圾桶删除非活跃会话 → 列表更新，当前对话不受影响

- [x] **Step 6: 提交**

```bash
cd N:/Data/Projects/memoria
git add web/src/pages/Chat.tsx
git commit -m "feat: Chat 页面新增会话删除按钮，hover 显示，删除活跃会话自动重置"
```
