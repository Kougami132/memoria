# Official QQ Bot Channel Compatibility Design

## Scope and Boundary

```text
QQ official Gateway
  -> authenticated persistent WebSocket
  -> Memoria QQ adapter
  -> channel-neutral inbound message
  -> system Agent / AgenticRagEngine.run_stream(bot_id=None)
  -> bounded final response
  -> QQ official REST API
  -> QQ user, group, or channel
```

The adapter owns QQ event parsing, token refresh, heartbeat, reconnect/resume, Web-configured ACL, target resolution, media policy, and output formatting. It always invokes Memoria's complete system-level Agent; QQ does not select or create a Memoria Bot and does not receive a reduced tool or prompt profile. The Agent engine remains responsible for sessions, RAG, tools, traces, and Host security. Approval authorization is an explicit channel policy layered around the existing Host approval mechanism.

## Web Configuration

The Web UI should manage, validate, and display the operational state of the QQ channel:

- enabled/disabled state, App ID, masked Client Secret, Gateway intents, and connection/reconnect status;
- C2C enablement, group enablement, guild enablement, user allowlist, group allowlist, and fail-closed versus allow-all policy;
- group trigger policy, including whether an @ mention is required, response format, message limits, and queue limits/timeouts;
- approval policy, including private approval enablement and the group approval default-deny switch;
- recent Gateway errors, last successful connection, token/credential validation result, and delivery failures.

The browser must never receive the Client Secret in plaintext. Configuration changes should be validated before enabling the adapter, and runtime state should be observable without making the existing Web/REST chat depend on QQ availability.

## Proposed Contracts

### Inbound message

The adapter should normalize an event into a structure containing:

- QQ app instance and event ID;
- context type: C2C, group, guild channel, or guild direct message;
- `user_openid`, `group_openid`, `guild_id`, and `channel_id` as applicable;
- message ID, text, selected media metadata, and raw event reference;
- resolved system-Agent internal session ID;
- authorization and trigger decisions.

QQ OpenID values are scoped identifiers and must not be treated as ordinary QQ numbers.

### Session mapping

Use a durable mapping keyed by at least:

```text
(qq_app_id, context_type, external_context_id, agent_scope)
```

The mapping resolves to an agentic session UUID in `sessions.id`. The `agent_scope` is a fixed value such as `system`, not a selectable Bot ID. Do not pass an OpenID or guild ID directly as a Memoria session ID.

### Outbound message

The channel layer should accept typed text, Markdown, and explicitly approved media actions. It should enforce QQ length limits, target type, rate-limit retry policy, and delivery error reporting. Agent-generated arbitrary QQ API calls must not be accepted in the first phase.

### Agent capability boundary

All ordinary QQ input uses the same system-Agent construction, prompt, knowledge bases, Host access, and tool registration as the existing system entry. The adapter may reject an unauthorized event or an unsafe approval interaction, but it must not silently remove Agent tools merely because the input arrived through QQ.

### Context scheduler

Use a per-context queue/actor keyed by the same external context key used for session mapping. Messages in one C2C conversation or group are processed in arrival order and at most one Agent run is active at a time. Different contexts use different queues and may run concurrently. Apply a bounded queue, duplicate-event check before enqueue, per-run timeout, cancellation on shutdown, and explicit overflow behavior.

## Lifecycle

Start and stop the adapter from the FastAPI lifespan. The adapter is a QQ Gateway WebSocket client, not a WebSocket server. It must obtain an app access token with `QQ_APP_ID` and `QQ_CLIENT_SECRET`, call the Gateway endpoint, send Identify with the configured intents, maintain heartbeat, and handle Resume/reconnect and QQ close codes. Deploy with one worker unless connection, deduplication, and approval state are externalized.

## Phased Shape

1. Text-only C2C and group @ messages, fixed routing to the system Agent, user/group allowlists, durable session mapping, and one final response.
2. Guild channels and direct messages, safe reply handling, bounded media download, and Markdown/media output.
3. Voice transcription through QQ `asr_refer_text` or a configured STT service.
4. Private approval interactions restricted to the initiating user, with expiry and audit metadata. Protocol research confirms that group approval can also bind to the initiating member through QQ's interaction identity fields, as demonstrated by Hermes. Enable it only after runtime permission and payload checks pass; otherwise reject group approval by default.

## Rollout and Rollback

The channel must be disabled by default. Enabling it should fail closed when app credentials, intents, bot binding, or allowlists are invalid. Existing REST and Web UI paths must not depend on QQ connection state.
