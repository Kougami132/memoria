# Logging Guidelines

> How logging is done in this project.

---

## Overview

The project uses Python's built-in `logging` module. Each module creates its own logger via `logger = logging.getLogger(__name__)`. There is no structured logging framework; log records are plain strings with optional `%`-style formatting args. The log file path is configurable via `settings.log_path` (default `./data/memoria.log`).

---

## Log Levels

- **DEBUG**: RAG pipeline internals - retrieval, chunk filtering, injected context, message counts, LLM prompt/response previews. Disabled in production (not configured by default). Essential for troubleshooting "why did the bot give a bad answer."
- **INFO**: Service lifecycle events - pipeline initialization, API client configuration (base_url, model names), scheduler start/stop. Use sparingly.
- **WARNING**: Recoverable failures in background operations - skipped files during vault sync, failed doc deletion, read errors. The operation continues; this records what was skipped.
- **ERROR**: Unrecoverable errors that reached the API layer - 502 responses from the chat endpoint. Always logged with context (bot_id, exception type).
- **EXCEPTION** (`.exception()`): Used in background threads and scheduled jobs where exceptions must not crash the process. Logs at ERROR level with a full traceback.

---

## Logger Initialization

Every module that logs starts with:

```python
import logging

logger = logging.getLogger(__name__)
```

Use `__name__` (not a hardcoded string) so the logger name follows the module hierarchy (`memoria.core.pipeline`, `memoria.server.routes.chat`, etc.).

---

## Logging Patterns

### RAG debug logging

The `Pipeline.query` method uses a consistent `[RAG]` prefix for debug-level logs, making them easy to grep:

```python
logger.debug("[RAG] bot=%s query=%r kb_ids=%s top_k=%d min_score=%.3f",
             bot_id, query, bot["kb_ids"], self._top_k, self._min_score)
logger.debug("[RAG] kb=%s retrieved %d chunks", kb_id, len(kb_chunks))
logger.debug("[RAG] after filter: %d/%d chunks passed min_score=%.3f",
             len(context_chunks), len(all_chunks), self._min_score)
logger.debug("[RAG] sending %d messages to LLM", len(messages))
logger.debug("[RAG] answer=%r", answer[:200])
```

### Exception logging in background threads

Background operations use `.exception()` to capture the full traceback:

```python
try:
    syncer.sync(vault["id"])
except Exception:
    logger.exception("vault poll failed: vault_id=%s", vault["id"])
```

### Route-layer error logging

For 502 errors, the route logs with context before re-raising as HTTPException:

```python
except (APIError, RuntimeError) as e:
    logger.error("Chat 502: bot=%s %s: %s", bot_id, type(e).__name__, e)
    raise HTTPException(status_code=502, detail=str(e))
```

### Skipped-file warnings in vault sync

Recoverable per-file failures use `.warning()` so the sync continues:

```python
except Exception:
    logger.warning("vault_sync: skip file read error %s", rel_path)
    return
```

---

## What to Log

- Pipeline initialization: model names, base_url (API key excluded)
- RAG retrieval results: chunk counts, scores, filtering thresholds
- Background job failures: vault sync errors with vault_id
- API layer errors: 502/503 responses with the request context (bot_id, session_id)
- Scheduled job lifecycle: APScheduler start/stop

---

## What NOT to Log

- **Credentials**: never log `openai_api_key`, `external_api_token`, or `webdav_password`. The pipeline init logs `base_url` and `model` but never credentials; authentication failures must not include token values.
- **Full document content**: RAG debug logs truncate text to 120 chars (`c["text"][:120]`). Never log full chunk text at INFO level.
- **Full LLM responses**: RAG debug logs truncate the answer to 200 chars (`answer[:200]`).
- **User PII**: message content is not logged at INFO level. Only the query is logged at DEBUG level via `%r`.

---

## Common Mistakes

1. **Using `logger = logging.getLogger("my-feature")` with a custom name.** Always use `__name__` so loggers follow the module hierarchy and can be filtered/configured uniformly.

2. **Using f-strings instead of `%`-style args.** The project consistently uses `logger.debug("msg %s %d", val1, val2)` style, not `logger.debug(f"msg {val1} {val2}")`. The `%` style defers string formatting until the log record is actually emitted, avoiding formatting overhead when DEBUG is disabled.

3. **Forgetting the `[RAG]` prefix in pipeline debug logs.** This prefix makes it easy to filter RAG-related logs. New pipeline debug logs should continue using it.

4. **Using `.error(str(e))` in background threads.** This loses the traceback. Use `.exception()` instead, which logs at ERROR level and includes the full stack trace.

5. **Logging full text/content.** Always truncate with slicing (`[:120]`, `[:200]`) to keep log output manageable and avoid leaking sensitive content.
