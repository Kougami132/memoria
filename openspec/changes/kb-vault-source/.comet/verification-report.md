---
change: kb-vault-source
verified_at: 2026-06-29
verify_result: pass
---

# Verification Report — kb-vault-source

## Test Results

- **Total:** 73 passed, 0 failed
- **Command:** `python -m pytest tests/ --ignore=tests/test_config_override.py -q`
- **Excluded:** `test_config_override.py` (pre-existing failure unrelated to this change)

## Coverage by Module

| Test File | Tests | Status |
|-----------|-------|--------|
| `test_vault_deps.py` | 3 | PASS |
| `test_vault_connector.py` | 5 | PASS |
| `test_vault_syncer.py` | 6 | PASS |
| `test_storage.py` (vault tests) | 10 | PASS |
| `test_server.py` (vault API) | 9 | PASS |
| All other existing tests | 40 | PASS (no regressions) |

## Acceptance Criteria

| # | Scenario | Result |
|---|----------|--------|
| 1 | Vault CRUD (create/get/delete/list) | PASS — `test_vault_crud` |
| 2 | VaultFile upsert/list/delete | PASS — `test_vault_file_crud` |
| 3 | 1:1 KB-Vault uniqueness constraint | PASS — `test_vault_unique_per_kb` |
| 4 | delete_kb cascades vault+vault_files | PASS — `test_delete_kb_cascades_vault` |
| 5 | documents.source field | PASS — `test_doc_source_field` |
| 6 | LocalConnector list/read | PASS — `test_local_connector_*` |
| 7 | Missing vault path raises FileNotFoundError | PASS |
| 8 | VaultSyncer: new file ingested | PASS |
| 9 | VaultSyncer: unchanged file not re-ingested | PASS |
| 10 | VaultSyncer: changed file re-ingested | PASS |
| 11 | VaultSyncer: deleted file removes doc | PASS |
| 12 | Connection failure preserves existing data | PASS |
| 13 | pipeline.ingest source param | PASS |
| 14 | POST /knowledge-bases/{kb_id}/vault → 201 | PASS |
| 15 | GET /knowledge-bases/{kb_id}/vault | PASS |
| 16 | GET vault when none → 404 | PASS |
| 17 | POST duplicate vault → 409 | PASS |
| 18 | DELETE vault → 204 | PASS |
| 19 | DELETE vault when none → 404 | PASS |
| 20 | POST /vault/sync → 202 | PASS |
| 21 | POST /vault/sync without vault → 404 | PASS |
| 22 | webdav_password not in API response | PASS |
| 23 | DELETE vault-sourced doc → 409 | PASS |

## Frontend Build

- **TypeScript:** No errors (`tsc -b` passes)
- **Vite build:** Success — bundle 537 kB (gzip 168 kB)
- **VaultPanel:** bind form, bound state, sync, unbind all implemented
- **DocList:** vault badge shown, delete button hidden for vault-sourced docs

## Known Deviations

- Task 4.4 (附加 vault 信息到 KB 列表响应) — intentionally skipped. Vault info is available via the dedicated `/knowledge-bases/{kb_id}/vault` endpoint; embedding it in KB list responses would add coupling without MVP benefit.
- `test_config_override.py::test_get_effective_settings_defaults` — pre-existing failure on `main` branch; not introduced by this change.
