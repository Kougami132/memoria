# Implementation Plan

1. Backend: move the current built-in prompt into `memoria/config.py`, add `system_prompt` to `Settings` and `get_effective_settings()`.
2. Backend: extend `SettingsUpdate` and the mapping in `memoria/server/routes/settings.py`; keep the existing empty-string reset semantics.
3. Backend: add `default_system_prompt` to `Pipeline`, resolve `bot["system_prompt"] or default_system_prompt` in `prepare_query`, and pass the effective value from `server/deps.get_pipeline()`.
4. Tests: update `test_config_override.py` for the new settings key; add Pipeline fallback and explicit-prompt-priority tests; add Settings API GET/PUT coverage.
5. Frontend: add `system_prompt` to `Settings`/`SettingsUpdate` in `web/src/api.ts`.
6. Frontend: add the “默认系统提示词” textarea to `Settings.tsx` and include it in the save payload.
7. Frontend: update `Bots.tsx` to fetch settings and pre-fill new Bot forms from `settings.system_prompt`; remove the local hardcoded default.
8. Rebuild `memoria/static` with `npm --prefix web run build`.

## Verification

- `python -m pytest tests/test_config_override.py tests/test_pipeline.py tests/test_server.py -q`
- `python -m pytest -q`
- `ruff check .`
- `npm --prefix web run lint`
- `npm --prefix web run build`
- Inspect the final diff for cross-layer consistency and confirm `memoria/static` was updated.
