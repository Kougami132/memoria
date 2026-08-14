# Design

Use the existing `Chat` page rather than introducing a second route. The page already owns bot selection, session selection, message rendering, and source rendering, so a mode switch is the smallest testable entry point.

- `web/src/api.ts`: add `AgentChatResponse`, `AgentSource`, and `agentChat()`.
- `web/src/pages/Chat.tsx`: add `mode` state (`classic`/`agentic`), use a separate mutation branch, and store optional `used_kbs` on messages. Agentic requests remain non-streaming as required by the backend PoC.
- `web/src/pages/Chat.tsx`: show a compact mode selector and an agentic badge/KB summary on assistant messages.
- Do not alter classic stream parser or classic endpoint.
