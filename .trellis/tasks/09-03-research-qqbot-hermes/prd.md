# Hermes QQ Bot Integration for Memoria

## Goal

Implement the official QQ Bot API v2 channel for Memoria by following the transport model verified in Hermes, while routing every accepted QQ message to the existing system Agent.

## Requirements

- Document the verified Hermes transport and message-processing behavior.
- Document the existing Memoria message, session, agent, database, and lifecycle boundaries relevant to an IM channel.
- Separate blocking conflicts from non-blocking differences and distinguish verified facts from design assumptions.
- Recommend a first implementation scope that forwards QQ messages only to Memoria's system-level Agent. QQ must retain the same Agent capabilities as the existing system entry; channel access control and approval policy are separate security boundaries, not a reduced Agent profile.
- Persist the research and planning artifacts under this task directory.
- Keep QQ disabled by default and expose all QQ connection and policy controls through the Web UI.

## Acceptance Criteria

- [x] Hermes official QQ Bot API v2 architecture, Gateway WebSocket, REST send flow, authentication, intents, reconnect, and deployment assumptions are documented.
- [x] Memoria compatibility is assessed against the current FastAPI, Agent engine, session, database, and configuration boundaries.
- [x] Conflicts are classified as blocking, non-blocking, or deferred scope.
- [x] A recommended architecture and phased implementation plan are documented, including OpenID session mapping to system Agent sessions, ACL, approval handling, concurrency, and media policy.
- [x] QQ adapter, Web configuration, session mapping, Gateway transport, delivery, approvals, and focused tests are implemented.
- [x] `python ./.trellis/scripts/task.py validate .trellis/tasks/09-03-research-qqbot-hermes` passes.

## Notes

- Reference: Hermes QQ Bot user guide: https://www.majiabin.com/hermes/user-guide/messaging/qqbot/
- The integration target is the official QQ Bot API v2, not OneBot, NapCat, go-cqhttp, or a reverse-WebSocket bridge.

## Confirmed Product Constraints

- QQ App ID, Client Secret, enable switch, Gateway intents, DM/group policies, user/group allowlists, group mention policy, response format, and approval policy are configurable from the Web UI.
- Credentials are write-only or masked when returned to the browser. Invalid or incomplete configuration fails closed and must expose connection status and recent Gateway errors in the Web UI.
- QQ messages always invoke the system Agent with `bot_id=None`; there is no QQ App-to-Memoria-Bot mapping and no QQ-specific Agent capability reduction.
- C2C conversations use one durable system-Agent session per `(qq_app_id, user_openid)`. Group conversations use one durable shared session per `(qq_app_id, group_openid)`.
- Every group message carries the sender OpenID in trusted message metadata so the shared session retains speaker identity without changing the Agent capability set.
- Private approval may be supported by binding confirmation to the initiating user and approval ID. Group approval is allowed only if the official event supplies a reliable initiating-user identity and the confirmation is bound to that identity; otherwise group approval is rejected by default. Web administrator approval remains a possible fallback and must be explicit in the permission model.
- The adapter serializes work per external context while allowing different contexts to run concurrently. Queue limits, timeout, cancellation, deduplication, and delivery state are required for backpressure and retries.
