# QQ Bot Implementation Record

## Completed Implementation

- [x] Inspect Hermes official QQ Bot API v2 documentation and adapter behavior.
- [x] Inspect Memoria FastAPI lifecycle, chat routes, Agent engine, session model, Bot model, and database methods.
- [x] Classify compatibility conflicts and record security and deployment assumptions.
- [x] Validate the Trellis task artifacts.
- [x] Present the recommendation and external prerequisites to the user.
- [x] Add disabled-by-default Web-managed QQ settings with masked Client Secret.
- [x] Add official Gateway token, Gateway URL discovery, WebSocket Identify/Resume, heartbeat, reconnect, and REST delivery.
- [x] Route C2C and group messages to the system Agent with `bot_id=None`.
- [x] Add durable C2C/user and group/shared-session mappings, event deduplication, ACL, mention filtering, queue limits, and timeouts.
- [x] Add private approval identity binding and default-deny group approval handling.
- [x] Add focused QQ tests and build the Web UI bundle.

## Remaining Runtime Work

1. Configure a real QQ Bot application, approved intents, and network access.
2. Run an end-to-end C2C test with a real App ID and Client Secret.
3. Run a group message test and verify the deployed Gateway interaction payload identity fields.
4. Keep group approvals disabled unless interaction identity binding and required permissions are confirmed in the deployed environment.
5. Review media, voice, guild, and richer QQ action support as separate increments.

## Verification Gates

- Existing REST and Web UI chat tests remain green.
- A fake QQ Gateway and REST service can authenticate, deliver a C2C/group event, invoke the Agent, and verify the response target.
- The same external context always resolves to the same system-Agent session, while different QQ contexts do not share sessions.
- Unauthorized users/groups and untriggered group messages produce no Agent run.
- Gateway disconnects do not leave orphaned tasks or stale heartbeats.
- A failed QQ REST send is observable and does not falsely mark delivery as successful.
- Web changes to QQ credentials and policies take effect only after validation, never expose the Client Secret, and show connection/delivery health.
- Messages in one group share one system-Agent session and execute serially; messages in different groups can execute concurrently.
- QQ runs the same system-Agent capability set as the existing system entry, while unauthorized events and unsupported group approvals fail closed.

## Validation Results

- `pytest -q tests/test_qqbot.py`: 5 passed.
- QQ module Ruff check: passed.
- Web production build: passed.
- Full pytest still has four pre-existing Agent/OpenAI route failures unrelated to QQ; those failures were not changed as part of this integration.
- Real QQ Gateway and REST account-level integration has not yet been run because no production App ID and Client Secret are configured.
