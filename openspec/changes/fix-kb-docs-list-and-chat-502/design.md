## Context

前端 `api.ts` 中 `listDocs(kbId)` 调用 `GET /api/knowledge-bases/{kbId}/documents`，而后端 `documents.py` 只注册了该路径的 POST（上传）路由，未注册 GET。FastAPI 的 SPA fallback 将该 GET 请求兜底返回 `index.html`（200），导致 React Query 尝试 JSON 解析 HTML 时失败，文档列表始终为空数组。

对话 502 由 `chat.py` 捕获 `(APIError, RuntimeError)` 后返回，缺少日志记录，运维无法从 server log 获取根因细节。

## Goals / Non-Goals

**Goals**
- 添加 `GET /knowledge-bases/{kb_id}/documents` 路由，返回该 KB 下的文档列表
- 在 chat 路由的 502 捕获分支记录完整异常到 logger

**Non-Goals**
- 不修改前端调用逻辑（路由设计已正确）
- 不改变 502 状态码语义

## Implementation

### Bug 1：添加 GET 路由

`memoria/server/routes/documents.py`，在现有 `@router.post` 下方追加：

```python
@router.get("/knowledge-bases/{kb_id}/documents")
def list_kb_documents(kb_id: str, db: DB = Depends(get_db)):
    return db.list_docs(kb_id)
```

已有的 `@router.get("/documents")` 保留不动（兼容其他可能调用方）。

### Bug 2：添加错误日志

`memoria/server/routes/chat.py`，在 `except (APIError, RuntimeError) as e:` 分支中：

```python
except (APIError, RuntimeError) as e:
    logger.error("Chat 502: bot=%s %s: %s", bot_id, type(e).__name__, e)
    raise HTTPException(status_code=502, detail=str(e))
```

需在文件顶部引入 `import logging` 并初始化 `logger`。
