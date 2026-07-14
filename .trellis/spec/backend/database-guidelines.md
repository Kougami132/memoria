# Database Guidelines

> Database patterns and conventions for this project.

---

## Overview

The project uses SQLAlchemy 2.0 with a single SQLite database. All database access is centralized in the `DB` class in `memoria/storage/db.py`. There is no Alembic or other migration framework; schema changes are handled inline in the `DB.__init__` constructor via `PRAGMA table_info` checks and `ALTER TABLE` statements. ORM row classes inherit from `Base(DeclarativeBase)` and are private to `db.py`. Every public `DB` method returns a plain dict (or `list[dict]`, or `None`), never an ORM object.

---

## ORM Setup

- **Base class**: `class Base(DeclarativeBase): pass` in `db.py`.
- **Engine**: `create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False}, poolclass=NullPool)`. `NullPool` is required because the app uses background threads and an async scheduler; a pool keeps connections alive across threads, so we open a fresh session each time.
- **Session factory**: `sessionmaker(bind=engine)` stored as `self._Session`.
- **Schema creation**: `Base.metadata.create_all(engine)` in `DB.__init__` creates any missing tables on startup.

---

## Query Patterns

All data access goes through the `DB` class. Each method follows this shape:

```python
def get_kb(self, kb_id: str) -> dict | None:
    with self._s() as s:
        row = s.get(KnowledgeBaseRow, kb_id)
        if row is None:
            return None
        return {"id": row.id, "name": row.name, ...}

def list_kbs(self) -> list[dict]:
    with self._s() as s:
        return [{"id": r.id, ...} for r in s.query(KnowledgeBaseRow).all()]
```

Key rules:

1. **Always use the `_s()` contextmanager** to open a session. This context commits on success, rolls back on exception, and closes the session in `finally`.
2. **Return dicts, not ORM objects.** Marshal the row fields into a dict inside the session, then return the dict. The session is closed when the `with` block exits; returning an ORM object would cause DetachedInstanceError.
3. **Use `s.get(Model, pk)`** for primary-key lookups. Use `s.query(Model).filter(...)` for other queries.
4. **`s.flush()` before returning** when you need the generated `id` or `created_at` populated, but let `_s()` handle `commit()`.
5. **Manual cascade deletes**: when deleting a KB, delete child rows explicitly (BotKBLink, VaultRow, VaultFileRow, DocumentRow) inside the same session before deleting the parent row.

The `_s()` contextmanager pattern:

```python
@contextmanager
def _s(self):
    s = self._Session()
    try:
        yield s
        s.commit()
    except Exception:
        s.rollback()
        raise
    finally:
        s.close()
```

---

## Migrations

There is no migration tool. Schema evolution is handled in `DB.__init__` with a series of `PRAGMA table_info` checks followed by `ALTER TABLE`:

```python
with engine.connect() as conn:
    kb_cols = [r[1] for r in conn.execute(text("PRAGMA table_info(knowledge_bases)"))]
    if "type" not in kb_cols:
        conn.execute(text("ALTER TABLE knowledge_bases ADD COLUMN type TEXT DEFAULT 'upload'"))
        conn.commit()
```

Guidelines:

1. **Add new columns at the end of `DB.__init__`**, after existing migration blocks.
2. **Always check before altering**: use `PRAGMA table_info(<table>)` to see if the column already exists.
3. **Provide safe defaults**: every `ADD COLUMN` must include a `DEFAULT` value so existing rows are valid.
4. **Never drop columns or tables in a migration** (SQLite has limited `DROP` support; instead, leave unused columns in place).
5. **For new tables**: add the ORM row class to `db.py`; `Base.metadata.create_all` will create it automatically on the next startup.

---

## Naming Conventions

- **Table names**: lowercase snake_case, plural or natural: `knowledge_bases`, `bots`, `documents`, `vault_files`, `sessions`, `messages`, `runtime_settings`, `bot_kb_links`.
- **Primary key**: `id`, type `Column(String)`, always a UUID v4 string via `_uid()`.
- **Foreign keys**: `<singular_table>_id`, e.g. `kb_id`, `bot_id`, `session_id`, `vault_id`.
- **Timestamps**: `created_at`, `synced_at`, `updated_at` - all stored as UTC ISO strings via `_now()` (which includes a timezone suffix).
- **Boolean-like flags**: stored as `Column(Integer)` with 0/1, e.g. `syncing`, `auto_sync`. The DB layer converts to Python `bool` in dict returns.
- **Unique constraints**: named `uq_<table>_<column>`, e.g. `UniqueConstraint("kb_id", name="uq_vaults_kb_id")`.
- **Composite PK**: used for link tables, e.g. `BotKBLink` has `bot_id` + `kb_id` as composite primary key.

---

## Common Mistakes

1. **Returning an ORM row object instead of a dict.** The session closes at the end of `_s()`, so any lazy field access afterward raises `DetachedInstanceError`. Always marshal to a dict inside the `with` block.

2. **Forgetting to `s.flush()` after adding a row.** If you need the auto-generated `id` or `created_at` for the return dict, call `s.flush()` before reading those fields. Without flush, `id` will be `None`.

3. **Using a shared `Session` across threads.** SQLite sessions are not thread-safe. Always open a fresh session per-operation via `_s()`. The `NullPool` + `check_same_thread: False` engine config supports this.

4. **Not cleaning up child rows on delete.** `delete_kb` manually deletes `bot_kb_links`, `vault_files`, `vaults`, and `documents` before deleting the KB row. New parent tables must do the same; SQLAlchemy auto-cascade is not configured.

5. **Storing timestamps as Python `datetime` objects.** The project stores all timestamps as UTC ISO strings (`datetime.now(timezone.utc).isoformat()`). ORM columns are `Column(String)`, not `DateTime`. Keep this convention for consistency.
