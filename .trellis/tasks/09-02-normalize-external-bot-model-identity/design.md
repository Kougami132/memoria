# Design: Normalize External Bot Model Identity

## Identity Contract

The internal `bots.id` remains the database primary key and is used by management routes, sessions, links, and engine calls. `Bot.name` is the user-visible label and a supported input alias. `Bot.model_key` is the stable external model identifier exposed by `/v1/models`. `model_override` continues to identify the underlying LLM model and is unrelated to Bot identity.

`model_key` is a user-visible, readable ASCII identifier such as `customer-support`. For ASCII names, the server can default to the readable slug `support-bot` and add a numeric suffix on collisions. A name containing Chinese or otherwise unable to produce a meaningful ASCII slug must provide `model_key` explicitly. The external model ID is `bot:<model_key>`. The key is kept stable across name changes; changing it is an explicit management operation because it changes the external integration identifier. A database uniqueness constraint protects uniqueness.

## Storage and Migration

- Add `model_key` to `BotRow` with a uniqueness constraint.
- Add an inline `PRAGMA table_info(bots)` migration in `DB.__init__` with a safe default, then fill empty/null values for existing rows using readable keys derived from names where possible.
- Keep migration idempotent and avoid changing the primary key or rebuilding unrelated tables. Convert empty legacy values and UUID-derived keys to readable keys where possible; use a clearly marked legacy fallback for names that need user configuration.
- Include `model_key` in `_bot_dict`, create, get, list, and update results. Create and update validate explicit keys and reject duplicates.
- Add DB lookup helpers for resolving a model string to a Bot record/dict by key, name, or internal ID. Keep precedence deterministic: exact `model_key`, exact name, legacy prefixed ID, then bare ID.

## API Behavior

`GET /v1/models` returns `memoria-agent` plus one `ModelObject(id=f"bot:{bot['model_key']}")` per Bot. It does not expose internal UUID aliases or the unprefixed key as a listed ID.

Both `/v1/chat/completions` and `/v1/responses` resolve the request model through the DB. The resolved internal ID is passed to the engine. The request's original model string remains in response fields for OpenAI-client compatibility. Bot invocation logs use the resolved Bot name; unresolved/default Agent calls use the existing model value.

Legacy inputs remain accepted for existing integrations, but they are compatibility inputs only and are not advertised by `/v1/models`.

## Frontend Behavior

The management `Bot` type includes `model_key`. The web chat continues to keep `botId` as the internal UUID for management/session endpoints, but `streamBotChat` accepts a model key and sends it to `/v1/responses`. The selected Bot object supplies the key; a temporary fallback to the internal ID is unnecessary once the API contract is updated and tests cover the returned field.

## Compatibility and Risks

- Unicode Bot names remain valid display labels and aliases. The external key intentionally avoids relying on client support for Unicode model identifiers.
- Name aliases can become ambiguous if duplicate Bot names are allowed. Resolution should reject ambiguity rather than silently choose a Bot, or use the existing name uniqueness behavior if already enforced by the DB. The implementation must make this behavior explicit in tests.
- API responses echo the requested model, so existing clients do not observe a response-shape change beyond the advertised model list.
