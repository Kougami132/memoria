# Technical Design

## Scope

Add one runtime setting, `system_prompt`, as the global default/fallback prompt. The setting is used in two places:

1. The Bots create form pre-fills the prompt textarea with the current default.
2. `Pipeline.prepare_query` uses the default when the selected Bot has an empty `system_prompt`.

Explicit Bot prompts, RAG reference injection, and the fixed output-format section remain unchanged.

## Backend Contract

### Config

- Add `system_prompt` to `Settings` with a default equal to the current built-in prompt from `web/src/pages/Bots.tsx`.
- Add `system_prompt` to `get_effective_settings()` so the runtime override layer applies.
- Empty override follows the existing settings behavior: the route deletes the `runtime_settings` row, so the effective value falls back to the env/default.

### Settings API

- Extend `SettingsUpdate` with `system_prompt: Optional[str]`.
- Include `system_prompt` in the route's key mapping.
- Existing `reset_pipeline()` call on any settings change remains in place; it makes the new fallback effective immediately for the singleton Pipeline.

### Pipeline

- Add a `default_system_prompt: str = ""` constructor argument.
- In `prepare_query`, resolve the system prompt as `bot["system_prompt"] or self._default_system_prompt`.
- Update `server/deps.get_pipeline()` to pass `default_system_prompt=effective["system_prompt"]`.

This matches the existing pattern where tunable values are captured when the Pipeline is rebuilt after settings changes.

## Frontend Contract

- Add `system_prompt` to the `Settings` and `SettingsUpdate` interfaces in `web/src/api.ts`.
- Add a textarea for “默认系统提示词” in the Settings page and include it in the save payload.
- In `Bots.tsx`, fetch `/api/settings` with TanStack Query and use `settings.system_prompt` as the pre-fill value for new Bot forms. Remove the local `DEFAULT_SYSTEM_PROMPT` constant.
- Keep the existing form behavior: editing an existing Bot still starts from that Bot's persisted `system_prompt`.

## Data Flow

Settings page save -> `PUT /api/settings` -> `runtime_settings.system_prompt` -> `get_effective_settings()` -> Pipeline rebuild with fallback -> `prepare_query()` resolves `bot.system_prompt or default_system_prompt` -> system message.

Bot create form -> `GET /api/settings` -> pre-filled prompt -> `POST /api/bots` -> `bots.system_prompt`.

## Compatibility and Risk

- No schema migration is required; `runtime_settings` is key/value.
- Existing Bots with non-empty prompts are unaffected.
- Existing Bots with empty prompts start using the global default. This is the intended fallback behavior, not a data migration.
- The frontend must rebuild `memoria/static` because those build artifacts are tracked in this repo.
- Risk is low: the change is additive to the settings API and only changes prompt resolution when Bot prompt is empty.

## Rollback

- Revert the code changes and rebuild the frontend; no data migration needs to be undone.
- To preserve current behavior for a user, save an empty `system_prompt` after setting a non-empty env default only if the env default is empty; otherwise editing the env default or reverting the commit restores prior behavior.
