# Official QQ Bot Integration Conflicts

## Blocking Conflicts

### 1. No channel abstraction

Memoria has REST/Web UI chat only. It lacks inbound/outbound contracts, platform metadata, delivery results, routing, and channel lifecycle ownership.

### 2. External QQ identifiers versus internal sessions

QQ uses `user_openid`, `group_openid`, `guild_id`, and `channel_id`. Memoria system-Agent sessions use random internal UUIDs and have no external QQ identity mapping. Durable mapping is mandatory.

### 3. System-Agent session routing is undefined

The incoming QQ event must deterministically map to the system Agent and to a durable agentic session. This is simpler than Bot routing, but the session key and context isolation still need to be defined.

### 4. Policy and permissions are absent

The adapter needs separate C2C/group/guild policies, OpenID allowlists, group @ triggers, self-message filtering, deduplication, and validated Gateway intents.

### 5. Approval has no QQ-safe contract

Web UI approval cannot be copied to a group. The first QQ phase should reject approval-requiring runs or support only expiring private confirmation bound to the initiating user.

### 6. Concurrency and deployment state are unspecified

Gateway events can arrive concurrently. Each external context needs serialized execution or an explicit queue policy. Multiple workers conflict with in-process Gateway, deduplication, and approval state unless coordination is externalized.

## Non-Blocking or Deferred Conflicts

### 7. Streaming output

Memoria emits Web-oriented deltas; QQ does not provide a uniform edit-stream contract. Buffering to one final response is suitable initially.

### 8. Media and voice

QQ structured media, local download limits, upload policy, and voice transcription need a channel-specific implementation. Text-only integration can ship first.

### 9. Rich QQ actions

Agent-facing arbitrary QQ API actions create a privilege escalation surface. Defer until capability-level authorization, audit, and confirmation exist.

### 10. Long messages and rate limits

The adapter needs QQ-specific chunking, REST rate-limit handling, and delivery observability. These are bounded channel concerns, not a fundamental engine conflict.

## External Prerequisites

- QQ Bot application credentials and approved Gateway intents/permissions;
- a selected C2C/group/guild scope and QQ platform policy;
- a fixed system-Agent routing policy and allowlist policy;
- network access to QQ Gateway and REST endpoints;
- operational handling for QQ rate limits, moderation, and credential rotation.
