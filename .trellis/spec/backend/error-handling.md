# Error Handling

> How errors are handled in this project.

---

## Overview

The backend does not define custom exception classes. Instead, it uses a consistent mapping from standard Python exceptions to FastAPI HTTP responses. Business logic raises `ValueError` for "not found" or "invalid input" conditions, and route handlers catch these and translate them to `HTTPException`. External service failures (OpenAI API) are caught and mapped to 5xx status codes. The `Pipeline` class is the main boundary where internal exceptions surface.

---

## Error Types

No custom exception hierarchy exists. The project relies on standard exceptions:

- **`ValueError`**: raised by business logic for "entity not found" or "invalid input" (e.g. `raise ValueError(f"Bot {bot_id} not found")`, `raise ValueError("Query must not be empty")`). Route handlers catch `ValueError` and map it to **404**.
- **`HTTPException`** (from `fastapi`): raised in route handlers for all client-facing errors. Always includes `status_code` and `detail` string.
- **`APIConnectionError`** (from `openai`): raised when the OpenAI-compatible endpoint is unreachable. Mapped to **503**.
- **`APIError`** (from `openai`): raised on API-level errors (bad request, auth failure). Mapped to **502**.
- **`RuntimeError`**: raised by the pipeline for unexpected internal failures. Mapped to **502**.
- **Bearer authentication failure**: OpenAI-compatible `/v1/*` routes return **401** with `WWW-Authenticate: Bearer` when an inbound token is configured and the request credential is missing or invalid.

---

## Error Handling Patterns

### Route handler pattern (canonical)

Every route handler wraps business logic in a try/except that maps exceptions to HTTP responses:

```python
from fastapi import APIRouter, Depends, HTTPException
from openai import APIConnectionError, APIError

@router.post("/{bot_id}")
def chat(bot_id: str, body: ChatRequest, pipeline: Pipeline = Depends(get_pipeline)):
    try:
        return pipeline.query(bot_id, body.message, body.session_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except APIConnectionError as e:
        raise HTTPException(status_code=503, detail=f"AI service unavailable: {e}")
    except (APIError, RuntimeError) as e:
        logger.error("Chat 502: bot=%s %s: %s", bot_id, type(e).__name__, e)
        raise HTTPException(status_code=502, detail=str(e))
```

### Validation before processing

Before calling business logic, route handlers validate state and raise `HTTPException` directly:

```python
if db.get_kb(kb_id) is None:
    raise HTTPException(status_code=404, detail="Knowledge base not found")
if kb["type"] != "vault":
    raise HTTPException(status_code=409, detail="Upload-type knowledge bases cannot bind a vault")
if db.get_vault_by_kb(kb_id) is not None:
    raise HTTPException(status_code=409, detail="Knowledge base already has a vault")
```

### Background thread pattern

Background operations (vault sync) catch all exceptions, log them, and set the `syncing` flag back to `False` in a `finally` block. They never let exceptions propagate to the caller (they are running in a daemon thread):

```python
def _initial_sync():
    cancel_event = threading.Event()
    _cancel_events[vault["id"]] = cancel_event
    try:
        VaultSyncer(db, pipeline).sync(vault["id"], cancel_event=cancel_event)
    except Exception:
        logger.exception("vault: initial sync failed vault_id=%s", vault["id"])
    finally:
        db.set_vault_syncing(vault["id"], False)
        _cancel_events.pop(vault["id"], None)
```

### Mock mode pattern

When `settings.use_mock` is `True`, the pipeline uses `MockEmbedder` and `MockLLMCaller` instead of real API clients. These never raise connection errors, making the entire system testable without external dependencies:

```python
if settings.use_mock:
    embedder = MockEmbedder()
    llm = MockLLMCaller()
```

---

## API Error Responses

All errors are returned as FastAPI's default JSON error format: `{"detail": "<message>"}`.

| Status | When | Example detail |
--------|------|---------------
| 401 | Missing or invalid configured inbound Bearer token on `/v1/*` | `"Invalid or missing bearer token"` |
| 404 | Entity not found (via `ValueError` catch or direct check) | `"Bot abc123 not found"` |
| 409 | Conflict (duplicate resource, wrong state) | `"Knowledge base already has a vault"` |
| 422 | Request validation failure (automatic, via Pydantic) | Pydantic validation message |
| 503 | AI service unreachable (`APIConnectionError`) | `"AI service unavailable: ..."` |
| 502 | AI service error (`APIError` / `RuntimeError`) | Original error message |

Status code conventions:

- **404**: entity not found. Business logic raises `ValueError`; route catches and converts.
- **401**: OpenAI-compatible inbound authentication failed. Include `WWW-Authenticate: Bearer`; do not echo or log the supplied token.
- **409**: conflict state. Route checks state directly and raises `HTTPException(409)`.
- **422**: request body validation. Handled automatically by FastAPI + Pydantic.
- **503**: dependency service unreachable. Use for network/connection failures.
- **502**: dependency service returned an error. Use for API errors from OpenAI-compatible services.

---

## Common Mistakes

1. **Letting `ValueError` escape to the client.** If a route handler does not catch `ValueError`, FastAPI returns a 500 with a stack trace. Always wrap business logic calls in try/except and map `ValueError` to 404.

2. **Using 500 for business logic errors.** The project maps "not found" to 404 and "conflict" to 409, never 500. Reserve 500 for truly unexpected internal errors that are not explicitly handled.

3. **Not resetting state in `finally`.** Background operations that set a `syncing` flag must always reset it in a `finally` block, even if an exception occurs. Otherwise the vault gets stuck in "syncing" state forever.

4. **Swallowing exceptions silently.** In background threads, always log with `.exception()` (which includes the traceback) rather than `.error(str(e))`. The vault syncer uses `logger.exception(...)` for failures and `logger.warning(...)` for skipped files.

5. **Exposing internal error details.** For 502/503 responses, the project passes `str(e)` as the detail, which may include API keys or internal paths. This is acceptable for the current single-user deployment model but should be reviewed if the API is ever exposed publicly.
