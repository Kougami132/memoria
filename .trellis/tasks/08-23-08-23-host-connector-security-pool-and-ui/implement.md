# Implementation Plan: Host Connector Security, Connection Pool, and UI Management

## Phase 1: Backend Security & Guardrails
- [ ] Implement `memoria/connectors/crypto.py` for symmetric secret encryption/decryption (Fernet with base64 key).
- [ ] Integrate secret encryption in `memoria/storage/db.py` / `memoria/server/routes/hosts.py` (ensure passwords/keys are encrypted in DB and masked in API responses).
- [ ] Implement `memoria/connectors/host/guard.py` for command validation (dangerous pattern blacklist, safe mode checks).
- [ ] Implement `memoria/connectors/host/pool.py` for connection caching with idle eviction and health checks.
- [ ] Wire `SSHConnectionPool` and `CommandGuard` into `HostConnector.execute_command`.

## Phase 2: Backend Tests & Verification
- [ ] Write unit tests for crypto encryption/decryption roundtrip.
- [ ] Write unit tests for command guard (blocking dangerous commands, safe mode).
- [ ] Write unit tests for connection pool lifecycle.
- [ ] Verify existing test suite continues to pass.

## Phase 3: Frontend Host Management & Bot Binding
- [ ] Update `web/src/api.ts` with Host endpoints and types.
- [ ] Create `web/src/pages/HostsPage.tsx` with list view, add/edit modal, and test connection action.
- [ ] Add route and Sidebar navigation item for Hosts.
- [ ] Update Bot creation/edit modal in `web/src/pages/BotsPage.tsx` / components to support selecting `host_ids`.
- [ ] Run `npm run build` in `web/` to verify frontend compile without errors.
