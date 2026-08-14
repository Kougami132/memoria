# Implementation Plan: 独立 Agentic RAG 页面

1. **Backend schema/session layer**
   - Read backend database spec and add nullable `bot_id`/`session_type` migration-compatible changes.
   - Add DB methods for Agentic session creation/listing and strict type checks.

2. **Agentic engine and routes**
   - Refactor engine to application scope and all-KB tools.
   - Add/adjust Agentic chat and session CRUD routes.
   - Keep classic chat route/pipeline untouched.

3. **Frontend API/navigation/page**
   - Remove mode switch and Agentic mutation from `Chat.tsx`.
   - Add typed Agentic endpoints in `api.ts`, route in `App.tsx`, sidebar link in `Layout.tsx`.
   - Implement `AgenticChat.tsx` with independent session list, message loading, rename/delete/new-session, and non-streaming send flow.

4. **Tests and validation**
   - Update/add backend tests for all-KB access, session CRUD/isolation, and classic regression.
   - Run `npm run lint`, `npm run build`, and `python -m pytest -q`.

5. **Trellis closeout**
   - Validate task context, finish active task, archive after implementation and checks pass.
