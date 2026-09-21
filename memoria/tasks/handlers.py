import asyncio
import logging
from typing import Any, Callable, Dict, Optional

logger = logging.getLogger(__name__)


def make_document_ingest_handler(pipeline_provider: Optional[Callable[[], Any]] = None):
    async def handle_document_ingest(payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Handler for task_type="document_ingest".
        payload: {"kb_id": str, "file_path": str, "orig_filename": str}
        """
        kb_id = payload["kb_id"]
        file_path = payload["file_path"]
        orig_filename = payload.get("orig_filename") or payload.get("filename")

        if pipeline_provider:
            pipeline = pipeline_provider()
        else:
            from memoria.server.deps import get_pipeline
            pipeline = get_pipeline()

        # Ingest document into vector store & DB (in worker thread)
        result = await asyncio.to_thread(
            pipeline.ingest,
            kb_id=kb_id,
            path=file_path,
            filename=orig_filename,
        )
        return result

    return handle_document_ingest


def make_vault_sync_handler(
    db_provider: Optional[Callable[[], Any]] = None,
    pipeline_provider: Optional[Callable[[], Any]] = None,
):
    async def handle_vault_sync(payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Handler for task_type="vault_sync".
        payload: {"vault_id": str}
        """
        vault_id = payload["vault_id"]
        if db_provider:
            db = db_provider()
        else:
            from memoria.server.deps import get_db
            db = get_db()

        if pipeline_provider:
            pipeline = pipeline_provider()
        else:
            from memoria.server.deps import get_pipeline
            pipeline = get_pipeline()

        from memoria.vault.syncer import VaultSyncer
        syncer = VaultSyncer(db, pipeline)
        result = await asyncio.to_thread(syncer.sync, vault_id)
        return result or {"status": "ok", "vault_id": vault_id}

    return handle_vault_sync


handle_document_ingest = make_document_ingest_handler()
handle_vault_sync = make_vault_sync_handler()
