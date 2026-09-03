# Hermes Official QQ Bot Architecture Research

## References

- User guide: https://www.majiabin.com/hermes/user-guide/messaging/qqbot/
- Hermes adapter source: `gateway/platforms/qqbot/adapter.py`, `constants.py`, `utils.py`, `crypto.py`
- Hermes repository: https://github.com/NousResearch/hermes-agent

This document corrects the earlier mistaken OneBot/NapCat reference. Hermes' documented integration is the official QQ Bot API v2.

## Verified Transport and Authentication

Hermes obtains an app access token from `https://bots.qq.com/app/getAppAccessToken` using `QQ_APP_ID` and `QQ_CLIENT_SECRET`. It then requests `https://api.sgroup.qq.com/gateway` and connects to the returned URL with a persistent WebSocket. After Hello it sends Identify with the bot token and configured intents.

The adapter handles heartbeat, token refresh, reconnect, Resume, and QQ Gateway close codes, including invalid token/session, rate limiting, invalid or unauthorized intents, sandbox/offline state, and bans. This is an outbound Gateway client from Hermes; it does not require a local reverse-WebSocket server or a QQ client implementation such as NapCat.

## Events and Contexts

The documented adapter handles `C2C_MESSAGE_CREATE`, `GROUP_AT_MESSAGE_CREATE`, guild events, direct messages, and interaction events. Message contexts are:

- C2C private chat, identified primarily by `user_openid`;
- group chat, identified by `group_openid` and generally requiring an @ trigger;
- guild channel and guild direct message, identified by `guild_id` and `channel_id`.

These are QQ-scoped OpenID or guild identifiers, not ordinary QQ account numbers.

## Outbound Flow

Hermes sends through official REST endpoints, including:

- `POST /v2/users/{openid}/messages` for C2C;
- `POST /v2/groups/{group_openid}/messages` for groups;
- the corresponding guild/channel endpoints.

The adapter supports text (`msg_type = 0`), Markdown (`2`), input notification (`6`), and media (`7`). Responses are bounded and split around the platform's message limits. Media upload supports image, video, voice, and file flows. Voice transcription can use QQ's `asr_refer_text` or a configured OpenAI-compatible STT service such as GLM-ASR/Whisper.

## Configuration and Security

Required credentials are `QQ_APP_ID` and `QQ_CLIENT_SECRET`. The guide also documents home channel settings, user/group allowlists, allow-all policy, portal host, Markdown support, DM/group policy, and STT configuration.

The important security boundary is QQ's intent and permission configuration. The adapter must also filter its own events, deduplicate message IDs, enforce separate C2C/group/guild policies, and avoid exposing arbitrary QQ actions to the Agent. QQ approval interactions need a separate authorization design.

## Dependencies

Hermes uses asynchronous HTTP/WebSocket support, including `aiohttp` and `httpx`. Memoria's existing `websockets` dependency may be reusable, but official QQ REST and token flows require confirming or adding an async HTTP client.
