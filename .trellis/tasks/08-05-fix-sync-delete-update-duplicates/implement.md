# Implementation Plan

1. Add a failing regression test using a real `DB` and a stubbed vector store to prove changed and deleted Vault documents disappear from SQLite and vectors.
2. Implement `Pipeline.delete_doc` to delete vectors by metadata and then the database document; update callers as needed without changing upload validation.
3. Adjust `VaultSyncer` deletion/replacement error handling so failed cleanup stops that file's replacement/removal and retains retryable tracking state.
4. Update `KnowledgeBases.tsx` to invalidate both Vault and document queries after a successful sync.
5. Run focused backend tests, the full Python test suite, frontend lint/type-check/build, and inspect the final diff for cross-layer consistency.

## Verification

- `python -m pytest tests/test_vault_syncer.py -v`
- `python -m pytest -q`
- `npm --prefix web run lint`
- `npm --prefix web run build`

The repository's current editable Python installation may need repair if collection resolves the package through an unavailable network share; record that environment limitation separately from code failures.
