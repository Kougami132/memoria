# Implementation Plan: Normalize External Bot Model Identity

## Planning and Migration

- [x] Record the external model-ID compatibility decision and affected package specs.
- [x] Add the stable ASCII `model_key` column, uniqueness protection, generation helper, and idempotent legacy-data backfill in `memoria/storage/db.py`.
- [x] Add model-key lookup methods and expose the field through Bot storage/routes/models.

## External API

- [x] Change `/v1/models` to advertise one `model_key` per Bot.
- [x] Update Chat Completions and Responses resolution and all success/error/stream logging paths to use the resolved Bot display name.
- [x] Preserve default Agent behavior, response model echoing, and legacy ID aliases.

## Frontend

- [x] Add `model_key` to the typed Bot API shape.
- [x] Send the selected Bot's `model_key` from web chat while retaining internal UUIDs for management and sessions.

## Tests and Validation

- [x] Add storage tests for generation, ASCII/uniqueness, rename stability, and legacy migration backfill.
- [x] Update external API tests for the advertised model list, new aliases, legacy compatibility, response echoing, and log display values.
- [x] Run focused backend tests, the full backend test suite, and `npm run build` in `web`.
- [x] Run the Trellis quality check and review cross-layer consistency before commit.

## Validation Notes

- Focused backend suite: `86 passed` (`tests/test_storage.py`, `tests/test_server.py`, `tests/test_placeholder.py`).
- Full backend suite: `164 passed, 5 failed`; failures are pre-existing route/authentication contract issues outside this task. The public Pydantic `Bot` model keeps `model_key` optional for direct construction compatibility, while persisted Bot responses always include the configured external key.
- `model_key` is not derived from the internal UUID. It is a readable ASCII external identifier: ASCII names receive a slug default, Chinese or otherwise non-ASCII names require an explicit key, and explicit key collisions are rejected.
- Frontend `npm run build`: passed on the second run after a transient Windows file-lock conflict from parallel builds.
- Frontend `npm run lint`: passed with five existing warnings.
- `git diff --check`: passed.
