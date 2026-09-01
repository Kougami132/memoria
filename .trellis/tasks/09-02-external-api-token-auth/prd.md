# 为外部调用增加 OpenAI 格式 Token 鉴权与系统设置配置

## Goal

Protect the OpenAI-compatible external API while keeping the built-in web application usable. Operators must be able to configure the inbound token from system settings, using the same bearer-token request shape expected by OpenAI-compatible clients.

## Requirements

### Authentication contract

- Protect the OpenAI-compatible routes under `/v1/`, including models, chat completions, and responses.
- Accept credentials only through `Authorization: Bearer <token>`.
- Reject missing, malformed, and incorrect credentials with HTTP 401 and a `WWW-Authenticate: Bearer` response header.
- Do not reuse `openai_api_key`; that setting is an outbound provider credential and has a different ownership and threat model.
- Compare configured and supplied tokens in constant time and do not log either value.
- Keep internal management routes under `/api/` outside this authentication boundary.

### Configuration

- Add a dedicated inbound token setting, exposed through the existing settings API and UI.
- Read an environment default from `EXTERNAL_API_TOKEN`, with the existing runtime settings override behavior taking precedence.
- An empty token means authentication is disabled for local/backward-compatible deployments. The settings UI must make this state visible so operators can enable protection deliberately.
- Runtime updates take effect for subsequent requests without restarting the server.
- Never include the token in normal logs or unrelated API responses.

### Web application compatibility

- The bundled React application must continue to call `/v1/responses` after authentication is enabled.
- The web client must obtain the configured token through the existing same-origin settings flow and send it as a bearer header for its OpenAI-compatible calls.
- The settings form must use a masked password-style control with an explicit reveal/hide action and preserve the existing save/reset behavior.
- Existing outbound provider settings and their semantics must remain unchanged.

### Compatibility and scope

- Preserve the existing OpenAI-compatible request and response schemas, streaming behavior, and status codes for authenticated requests.
- Do not add a second authentication mechanism based on `X-Memoria-Client`; that header is informational only.
- Update automated tests and operator-facing configuration documentation/examples as needed.

## Acceptance Criteria

- [ ] `GET /v1/models`, `POST /v1/chat/completions`, and `POST /v1/responses` reject unauthorized requests when a token is configured.
- [ ] The same routes accept a valid `Authorization: Bearer <configured-token>` header, including streaming responses.
- [ ] Missing, malformed, and wrong bearer credentials consistently return 401 with the bearer challenge header and do not invoke pipeline work.
- [ ] `EXTERNAL_API_TOKEN` is available as the environment default and a saved system setting overrides it at runtime.
- [ ] Clearing the setting returns the service to the documented local compatibility mode; changing it invalidates the old token immediately.
- [ ] The settings API and UI expose the inbound token as a dedicated masked field without conflating it with `openai_api_key`.
- [ ] The bundled web chat continues to work with the configured token and does not regress streaming or trace logging.
- [ ] Focused backend tests, the full backend test suite where feasible, and frontend type-check/lint/build pass.

## Constraints

- Follow the existing FastAPI dependency, effective-settings, typed frontend API, TanStack Query, and shadcn/ui patterns.
- Keep the implementation narrowly scoped to inbound OpenAI-compatible authentication and its configuration path.
- Documentation in Trellis artifacts is written in English per project conventions.
