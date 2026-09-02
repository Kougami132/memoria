# External Model ID Compatibility Research

## Finding

JSON and Python/TypeScript strings can carry Unicode, so Chinese Bot names can technically be sent as a `model` value. However, the OpenAI-compatible model-list contract is consumed by SDKs, selectors, proxies, and routing layers that commonly assume stable opaque string keys and may apply ASCII-oriented validation or serialization rules. Names are also mutable and may not be unique.

## Decision

Use a stable, user-visible, ASCII-only `model_key` as the canonical external `model_id`. Derive it as a readable slug from ASCII Bot names when possible; require the user to provide the ASCII key for names such as Chinese that cannot produce a meaningful identifier. Keep the Bot name as a display label and a convenient alias for direct conversation requests. Do not claim that the protocol absolutely forbids Chinese; this is a compatibility, stability, and rename-safety decision.

## Local Constraints

- The project has no Alembic migration layer; schema changes belong in `DB.__init__` using `PRAGMA table_info` and idempotent `ALTER TABLE` blocks.
- DB methods return plain dictionaries, and external routes should not import ORM row classes.
- The web client already loads Bot objects and separately uses internal IDs for management/session routes, so only the external streaming model argument needs to change.
