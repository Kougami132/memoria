# Verification Report: web-ui-playground

- **Date**: 2026-06-28
- **Branch**: feature/20260627/web-ui-playground
- **Base ref**: 3be0745b8574412e9543643878b98405a804c239
- **verify_mode**: full (25 tasks, 6 capabilities, 69 files changed)

---

## Summary

| Dimension    | Status                          |
|--------------|---------------------------------|
| Completeness | 25/25 tasks ✅, 6 capabilities ✅ |
| Correctness  | All spec scenarios covered ✅    |
| Coherence    | Design followed ✅, 2 minor doc divergences (SUGGESTION) |

**Test result (fresh run):** `43 passed, 2 warnings in 8.83s` — 0 failures.

**Final assessment:** No critical issues. No warnings. 2 suggestions (non-blocking). Ready for archive.

---

## Completeness

### Tasks: 25/25 complete

All 25 tasks checked `[x]` in `openspec/changes/web-ui-playground/tasks.md`.  
Confirmed via `openspec instructions apply --change web-ui-playground --json`: `"state": "all_done"`.

### Capabilities: 6/6 covered

| Capability | Status |
|------------|--------|
| `web-ui` | ✅ React SPA built and mounted via `StaticFiles` |
| `runtime-settings` | ✅ `runtime_settings` table + `GET/PUT /api/settings` |
| `chat-sources` | ✅ `sources` field in `pipeline.query()` response |
| `session-list` | ✅ `GET /api/bots/{bot_id}/sessions` |
| `rag-query` (modified) | ✅ `sources` appended to response |
| `chat-session` (modified) | ✅ `list_sessions` + full message history endpoint |

---

## Correctness: Spec Scenario Coverage

### runtime-settings spec

| Scenario | Evidence | Result |
|----------|----------|--------|
| 覆盖值生效 | `config.py:35` `fields.update(overrides)` — DB values override env defaults | ✅ |
| 回退到环境变量 | Only updates field if key present in DB overrides dict | ✅ |
| 保存后新对话使用新配置 | `deps.py:34` passes `top_k=int(effective["top_k"])` to Pipeline | ✅ |
| api_key 字段为空时不覆盖 | `settings.py:41` `if value is not None and value != ""` guard | ✅ |

### chat-session spec

| Scenario | Evidence | Result |
|----------|----------|--------|
| 查询指定 Bot 的会话（倒序） | `db.list_sessions(bot_id)` — test `test_list_sessions` passes | ✅ |
| 正常返回全量消息 | `sessions.py:13` `db.get_messages_all(session_id)` | ✅ |
| 会话不存在时返回 404 | `sessions.py:11-12` raises `HTTPException(404)` | ✅ |

### session-list spec

| Scenario | Evidence | Result |
|----------|----------|--------|
| 正常返回会话列表 | `bots.py:60-64` `db.list_sessions(bot_id)` | ✅ |
| Bot 无会话时返回空数组 | `list_sessions` returns `[]` when no sessions exist | ✅ |
| Bot 不存在时返回 404 | `bots.py:62` checks `get_bot` → 404 | ✅ |

### rag-query spec

| Scenario | Evidence | Result |
|----------|----------|--------|
| 正常单轮查询含 answer/session_id/sources | `pipeline.py:84-91` | ✅ |
| Bot 无关联 KB，sources 为空数组 | `all_chunks=[]` → `context_chunks=[]` → `sources=[]` | ✅ |

### chat-sources spec

| Scenario | Evidence | Result |
|----------|----------|--------|
| 有检索结果时返回 sources [{text, score, doc_id}] | `pipeline.py:87-89` flat dict access `c["doc_id"]` | ✅ |
| 无检索结果时返回空列表 | `sources=[]` when context_chunks empty | ✅ |

### web-ui spec

| Scenario | Evidence | Result |
|----------|----------|--------|
| 访问根路径返回 index.html | `app.py:25` `StaticFiles(html=True)` | ✅ |
| API 路由不受影响 | API routes registered before static mount | ✅ |
| 创建知识库 | `KnowledgeBases.tsx` createKB → POST /api/knowledge-bases | ✅ |
| 上传文档 | uploadDocument with multipart FormData | ✅ |
| 删除文档 | deleteDocument → DELETE /api/documents/{docId} | ✅ |
| 创建/编辑 Bot | `Bots.tsx` with KB multi-select, model_override | ✅ |
| 新建会话（无 session_id） | `Chat.tsx:75` chat without sessionId | ✅ |
| 切换历史会话加载消息 | `Chat.tsx:68-71` loadSession → getMessages | ✅ |
| 查看引用来源（折叠展示） | `Chat.tsx` SourceList collapsible component | ✅ |
| 加载当前配置 | `Settings.tsx` useQuery getSettings | ✅ |
| 修改并保存，提示"配置已保存，Pipeline 已重建" | `Settings.tsx:103` | ✅ |
| api_key 显示 `****`，不填不覆盖 | type="password" default + conditional send | ✅ |

---

## Coherence

### Design doc adherence: followed

Key design decisions verified:

- DB schema: `RuntimeSettingRow` ORM with `create_all` — ✅ `db.py`
- Pipeline rebuild: module-level `_pipeline` + `reset_pipeline()` — ✅ `deps.py:10-41`
- `top_k` runtime effect: `Pipeline.__init__(top_k=...)` + `self._top_k` — ✅ `pipeline.py:15,43,55`
- Static mount with existence check + warning — ✅ `app.py:22-27`
- `api.ts` covers all required endpoints — ✅ `web/src/api.ts`

### Delta spec vs Design Doc divergences

No contradictions. One build-phase fix not reflected in design doc code snippet (see SUGGESTION below).

---

## Issues

### CRITICAL
_None_

### WARNING
_None_

### SUGGESTION

**S1**: `design.md` code snippet for `app.py` shows original path `os.path.dirname(__file__) + "static"` (resolves to `memoria/server/static/`, wrong), while implementation correctly uses `os.path.join(..., "..", "static")`. Design doc code example is stale — no runtime impact, documentation only.

**S2**: `design.md` describes Settings page `api_key` toggle as "眼睛 icon 切换", but implementation uses "Show/Hide" text button. Functionally equivalent, minor UI deviation from design prose.

Both are doc-level only and do not affect correctness, security, or user experience.

---

## Security

- No hardcoded secrets or credentials in committed code
- `api_key` never logged; stored in SQLite (local single-user service, explicitly in scope)
- No new unsafe operations introduced

---

## Build Evidence

```
python -m pytest tests/ -q
43 passed, 2 warnings in 8.83s
```

Warnings are pre-existing (Pydantic v1 class-based config deprecation, httpx starlette deprecation) — not introduced by this change.
