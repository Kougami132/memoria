# Recommendation

## Conclusion

Memoria can integrate with QQ using the same broad model as Hermes, but the target is the official QQ Bot API v2: Hermes is a Gateway WebSocket client for inbound events and uses official REST APIs for outbound messages. OneBot, NapCat, and reverse WebSocket are unrelated to this integration and should not be introduced.

Memoria's system-level Agent engine and persistence are reusable. The integration is not entirely drop-in because it lacks a channel layer, durable external-session mapping, Web-managed QQ policy, and a QQ-safe approval contract. There is no need to introduce QQ app-to-Bot routing. The QQ adapter should invoke the same complete system-Agent capability set; access control and approval checks happen at the channel boundary.

## Recommended Architecture

```text
QQ Gateway WebSocket
  <-> official QQ adapter (token, heartbeat, resume, reconnect, ACL)
  <-> normalized channel message
  <-> Memoria agentic-session mapping and system Agent facade
  <-> official QQ REST API
```

Keep the engine unaware of QQ. Start the adapter from FastAPI lifespan, disable it by default, and always call the system Agent path with `bot_id=None`.

## Confirmed Decisions

- All QQ connection and policy settings are managed from the Web UI: credentials, enablement, intents, C2C/group switches, user/group allowlists, group mention rules, output/queue limits, and approval policy. Client Secret is masked and never returned in plaintext.
- C2C maps `(qq_app_id, user_openid)` to one system-Agent session. A group maps `(qq_app_id, group_openid)` to one shared system-Agent session. Each message includes the sender identity as metadata.
- QQ has capability parity with the existing system Agent. There is no Bot ID routing and no QQ-specific tool reduction.
- Private approval can be supported by binding approval confirmation to the initiating user. Group approval is default-deny unless the official event identity and confirmation binding are proven reliable; Web administrator approval may remain an explicit fallback.
- Per-context queue/actor execution is the recommended architecture: same context serial, different contexts parallel, bounded queue and explicit overflow/timeout behavior.

## First Release Scope

- Official QQ Bot API v2 only;
- C2C and group @ messages, with guild support deferred;
- fixed routing to Memoria's system-level Agent, with no QQ Bot binding;
- OpenID user/group allowlists and fail-closed policies;
- self-message filtering, event deduplication, and per-context serialization;
- durable mapping from QQ app/context/OpenID to internal agentic session UUID;
- text input and one bounded final text or Markdown response;
- Gateway token, heartbeat, Resume, reconnect, and rate-limit handling;
- no arbitrary QQ action tools; ordinary system-Agent tools remain available exactly as they are through the existing system entry;
- private approval only when identity binding is implemented, with group approval rejected by default;
- one-worker deployment unless state is externalized.

## Implementation Sequence

1. Configuration and validation, disabled by default.
2. Official Gateway client and REST client.
3. Channel-neutral contracts, fixed system-Agent routing, and session mapping.
4. ACL, triggers, deduplication, ordering, and delivery errors.
5. Engine invocation and final response formatting.
6. Focused protocol, policy, mapping, reconnect, and delivery tests.
7. Separate reviews for media, voice, guilds, and approval interactions.

## Validation Boundary

The product decisions above are settled. Protocol-level research has already verified the group-approval shape: QQ's official interaction payload declares `group_openid`, `group_member_openid`, and `user_openid`; official BotPy defines inline-keyboard interaction types; and Hermes sends approval buttons, receives `INTERACTION_CREATE`, and authorizes the clicker against the initiating member.

Implementation must still verify App permission grants, Identify intents, real Gateway delivery, interaction ACK behavior, and whether the deployed environment consistently supplies a non-empty clicker identity. These are runtime and permission checks. If they are inconclusive, retain the default-deny group approval policy. QQ should use the existing system Agent directly; do not create or select a Memoria Bot for QQ messages.
