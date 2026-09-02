# Normalize External Bot Model Identity

## Goal

Expose each Bot through one stable, OpenAI-compatible external model identifier while keeping the Bot's human-readable name available for normal conversation and display.

## Requirements

- Add a user-visible `model_key` to every Bot. It must be unique, readable, stable, ASCII-only, and must not contain whitespace or Chinese characters. ASCII names may receive a readable `bot-<slug>` default; names that cannot produce an ASCII slug must provide it explicitly.
- Accept `model_key` when creating or repairing a Bot, validate it, and allow changing it explicitly because it is the external integration identifier.
- Return exactly one external model entry per Bot from `/v1/models`, using `model_key`; do not list the internal Bot UUID or `bot:<internal-id>` entries.
- Resolve chat requests by `model_key` and Bot name, while retaining compatibility with `bot:<internal-id>` and the bare internal Bot UUID.
- Keep the default `memoria-agent` model behavior unchanged.
- Use the Bot name as the model value in API invocation logs when a Bot request resolves successfully; preserve the requested model in API response payloads.
- Return `model_key` in management Bot responses so the web client can use it for external chat requests. Internal management routes and session relationships continue using the Bot UUID.
- Existing databases must gain and backfill the new column idempotently without losing existing Bots or changing their names.

## Acceptance Criteria

- [x] Newly created Bots receive readable unique ASCII-only `model_key` values, with explicit input required for Chinese names.
- [x] Renaming a Bot does not change its `model_key`; duplicate keys cannot be created.
- [x] Existing databases start successfully and every existing Bot has a non-empty unique `model_key` after migration.
- [x] `/v1/models` contains one model entry for each Bot, with no duplicate internal-ID aliases.
- [x] Chat Completions and Responses accept `model_key`, Bot name, and legacy Bot ID forms, with consistent streaming and non-streaming behavior.
- [x] API invocation logs use the resolved Bot name for Bot calls and retain default Agent logging behavior.
- [x] The web chat sends the selected Bot's `model_key`, while management API calls still use the internal Bot UUID.
- [x] Backend tests and the web TypeScript/build checks pass.
