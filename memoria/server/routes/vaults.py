from __future__ import annotations

import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel

from memoria.core.pipeline import Pipeline
from memoria.server.deps import get_db, get_pipeline
from memoria.storage.db import DB
from memoria.vault.syncer import VaultSyncer

logger = logging.getLogger(__name__)

router = APIRouter(tags=["vaults"])


class VaultCreate(BaseModel):
    type: str
    local_path: Optional[str] = None
    webdav_url: Optional[str] = None
    webdav_username: Optional[str] = None
    webdav_password: Optional[str] = None


def _mask_vault(vault: dict) -> dict:
    v = dict(vault)
    v.pop("webdav_password", None)
    return v


def _delete_vault_docs(db: DB, pipeline: Pipeline, vault_id: str, kb_id: str) -> None:
    for vf in db.list_vault_files(vault_id):
        if vf["doc_id"]:
            try:
                store = pipeline._get_store(kb_id)
                store.delete(where={"doc_id": vf["doc_id"]})
            except Exception:
                logger.warning("vault: failed to delete chroma vectors for doc %s", vf["doc_id"])
            db.delete_doc(vf["doc_id"])


@router.post("/knowledge-bases/{kb_id}/vault", status_code=201)
async def bind_vault(
    kb_id: str,
    body: VaultCreate,
    background_tasks: BackgroundTasks,
    db: DB = Depends(get_db),
    pipeline: Pipeline = Depends(get_pipeline),
):
    if db.get_kb(kb_id) is None:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    kb = db.get_kb(kb_id)
    if kb["type"] != "vault":
        raise HTTPException(status_code=409, detail="Upload-type knowledge bases cannot bind a vault")
    if db.get_vault_by_kb(kb_id) is not None:
        raise HTTPException(status_code=409, detail="Knowledge base already has a vault")

    try:
        vault = db.create_vault(
            kb_id, body.type,
            local_path=body.local_path,
            webdav_url=body.webdav_url,
            webdav_username=body.webdav_username,
            webdav_password=body.webdav_password,
        )
    except Exception:
        raise HTTPException(status_code=409, detail="Knowledge base already has a vault")

    def _initial_sync():
        try:
            VaultSyncer(db, pipeline).sync(vault["id"])
        except Exception:
            logger.exception("vault: initial sync failed vault_id=%s", vault["id"])

    background_tasks.add_task(_initial_sync)
    return _mask_vault(vault)


@router.get("/knowledge-bases/{kb_id}/vault")
def get_vault(kb_id: str, db: DB = Depends(get_db)):
    vault = db.get_vault_by_kb(kb_id)
    if vault is None:
        raise HTTPException(status_code=404, detail="No vault bound to this knowledge base")
    return _mask_vault(vault)


@router.delete("/knowledge-bases/{kb_id}/vault", status_code=204)
def delete_vault(
    kb_id: str,
    db: DB = Depends(get_db),
    pipeline: Pipeline = Depends(get_pipeline),
):
    vault = db.get_vault_by_kb(kb_id)
    if vault is None:
        raise HTTPException(status_code=404, detail="No vault bound to this knowledge base")
    _delete_vault_docs(db, pipeline, vault["id"], kb_id)
    db.delete_vault(vault["id"])


@router.post("/knowledge-bases/{kb_id}/vault/sync", status_code=202)
async def sync_vault(
    kb_id: str,
    background_tasks: BackgroundTasks,
    db: DB = Depends(get_db),
    pipeline: Pipeline = Depends(get_pipeline),
):
    vault = db.get_vault_by_kb(kb_id)
    if vault is None:
        raise HTTPException(status_code=404, detail="No vault bound to this knowledge base")

    def _run_sync():
        try:
            VaultSyncer(db, pipeline).sync(vault["id"])
        except Exception:
            logger.exception("vault: manual sync failed vault_id=%s", vault["id"])

    background_tasks.add_task(_run_sync)
    return {"status": "sync started"}
