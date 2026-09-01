# Implementation Plan: OpenAI-Compatible Inbound Token Authentication

## Ordered work

1. Inspect the effective settings, settings route, OpenAI router, chat streaming call, and existing test fixtures; record any test setup constraints before editing.
2. Add `external_api_token` to configuration defaults/effective settings and the settings API update/response path, preserving runtime override precedence.
3. Implement a reusable FastAPI bearer-token dependency using `Authorization`, `WWW-Authenticate`, and constant-time comparison; attach it to the OpenAI-compatible router.
4. Update backend tests for missing, malformed, invalid, and valid credentials across models, chat completions, and responses, including streaming and token rotation.
5. Update the typed frontend API layer and Settings page with a masked inbound-token control and visibility toggle.
6. Update the web OpenAI-compatible request path to send the configured bearer token while preserving streaming and trace headers.
7. Update `.env.example` and relevant operator documentation with the environment variable and request example.
8. Run focused backend tests, the complete backend test suite, frontend type-check/lint/build, and inspect the final diff for secret leakage or unrelated changes.

## Validation commands

```powershell
pytest tests/test_server.py tests/test_openai_stream_traces.py tests/test_all_features_verification.py
pytest
cd web; npm run typecheck; npm run lint; npm run build
```

Use the repository’s actual frontend script names if they differ. If the production build is committed into `memoria/static/`, regenerate it only after confirming that is the established repository workflow.

## Review gates

- Do not start implementation until `prd.md`, `design.md`, and this plan are reviewed and the task is moved to `in_progress`.
- Before completion, verify `/api/settings` remains reachable for initial configuration and that `/v1/*` behavior is unchanged for authenticated callers.
- Confirm no token appears in logs, test snapshots, generated bundles beyond the intended runtime setting flow, or documentation examples.

## Rollback points

- Configuration/API changes can be reverted independently before enabling a token.
- Router dependency changes can be removed to restore the prior unauthenticated behavior.
- Frontend changes can be reverted without changing stored settings because the new key is additive.
