# Agentic RAG Frontend Entry

## Goal
Expose the completed Agentic RAG sidecar through the web UI so it can be tested without manually calling the API, while preserving the existing classic chat experience.

## Scope
- Add typed API interfaces and a named `agentChat` client function.
- Add an agentic/classic mode control to the existing bot chat page.
- Reuse the selected bot and existing session flow.
- Render agentic `used_kbs` and backend-collected sources.
- Keep classic chat streaming and behavior unchanged.
- Build the frontend and run lint/type checks.

## Acceptance Criteria
- [ ] A user can enter Agentic mode from the existing chat page.
- [ ] Agentic mode calls `/api/bots/{bot_id}/agent-chat` and displays the answer.
- [ ] Agentic responses display selected knowledge bases and structured sources.
- [ ] Existing classic mode remains available and unchanged.
- [ ] TypeScript build and lint pass.
