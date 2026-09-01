# Technical Design: OpenAI-Compatible Inbound Token Authentication

## Boundary

Authentication is applied at the OpenAI-compatible router boundary in `memoria/server/routes/openai.py`. It covers every `/v1/*` route in that router and leaves the existing `/api/*` management surface unchanged. `X-Memoria-Client` remains an observability header and is never used as an authorization bypass.

## Configuration and data flow

1. Add `external_api_token` to the application settings model with `EXTERNAL_API_TOKEN` as its environment default.
2. Extend `get_effective_settings()` so the persisted runtime setting overrides the environment value using the same precedence as the other settings.
3. Add the field to the settings update allowlist and typed response/request models.
4. The authentication dependency reads effective settings per request, extracts the `Authorization` header, validates the exact `Bearer <token>` form, and compares the token with `secrets.compare_digest`.
5. An empty effective token is an explicit compatibility mode and allows the request. A non-empty token makes the bearer header mandatory.

This keeps token rotation immediate and avoids process-global cached credentials. It also keeps the inbound token separate from outbound OpenAI credentials.

## HTTP contract

Unauthorized requests return:

```json
{"detail":"Invalid or missing bearer token"}
```

with status `401` and header `WWW-Authenticate: Bearer`. The dependency must reject a missing header, a non-Bearer scheme, an empty credential, and a mismatched credential before route business logic runs. It must not echo the supplied token or write it to logs.

Authenticated requests pass through without changing request validation, response schemas, error handling, or streaming behavior.

## Settings UI and bundled web client

The settings response includes the dedicated `external_api_token` value following the project’s existing single-user settings model. The Settings page renders it as a password input with a lucide eye/eye-off toggle, labels it as the inbound OpenAI-compatible API token, and saves it through the existing settings mutation.

The direct browser request used by the chat flow obtains the token from the settings query/cache and adds `Authorization: Bearer ...` only when the value is non-empty. This preserves compatibility mode and prevents the UI from relying on the spoofable client marker.

## Security considerations

- Use constant-time comparison for non-empty configured tokens.
- Avoid logging request headers and token values.
- Do not reuse or overwrite `openai_api_key`.
- The settings API is intentionally still same-origin and unprotected because this application’s existing model treats it as a local single-user management surface. Deployments exposed to untrusted users must place the application behind an appropriate access-control boundary.

## Rollout and rollback

The change is additive. Existing deployments with no `EXTERNAL_API_TOKEN` continue in compatibility mode until an operator configures a token. Operators can rotate or clear the token through system settings; clearing it restores compatibility mode. Rollback consists of removing the router dependency and the dedicated settings/UI field, with no schema migration expected because settings are stored as key/value configuration.

## Verification strategy

- Unit/API tests cover all three OpenAI-compatible routes, all credential failure forms, valid credentials, runtime rotation, and empty-token compatibility.
- Existing streaming and trace tests are updated to provide a token when the test fixture configures one.
- Frontend checks cover TypeScript, lint, and production build; the API layer remains the only place for browser fetch behavior.
