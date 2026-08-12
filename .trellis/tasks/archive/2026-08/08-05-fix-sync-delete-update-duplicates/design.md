# Technical Design

## Root Cause

`VaultSyncer` calls `pipeline.delete_doc(doc_id, kb_id)`, but `Pipeline` has no such method. The resulting `AttributeError` is caught and discarded by the syncer. The database document therefore remains, while a changed file is ingested as a new document. The frontend also invalidates only the vault query after a sync, leaving the document list cache stale until another refresh; this cannot explain persistence after a full reload, so both layers require a fix.

## Data Flow

Source connector -> `VaultSyncer` hash/diff -> `Pipeline` vector and document deletion or ingestion -> SQLite `documents` + `vault_files` and Chroma collection -> `/documents` API -> TanStack Query document list.

## Backend Contract

- Add `Pipeline.delete_doc(doc_id, kb_id)` as the single document deletion operation for document rows created by the pipeline.
- Delete Chroma entries by their metadata `doc_id`, then delete the matching SQLite document row.
- Let deletion errors propagate to the sync boundary. A failed deletion must not be followed by ingestion of a replacement or removal of the `vault_files` tracking row.
- Preserve existing manual document deletion behavior by routing it through the same pipeline operation where practical, while retaining its existing validation for Vault-sourced documents.

## Sync Replacement Behavior

For a changed tracked file, remove the old document and vectors successfully first, then ingest the new content and upsert the existing `vault_files` row. For a deleted file, remove the document successfully first, then delete the tracking row. If either operation fails, log the failure with traceback and keep the tracking row so a later sync can retry.

## Frontend Contract

When `syncVault` resolves successfully, invalidate both `['vault', kbId]` and `['docs', kbId]`. This keeps the status/count and document list synchronized with the backend.

## Compatibility and Risk

No schema change is required. Existing vector metadata already contains the pipeline document ID and Chroma supports `delete(where=...)`. The main risk is partial failure between vector deletion and SQLite deletion; the implementation should make the order explicit and retain tracking state for retry rather than hiding the error.
