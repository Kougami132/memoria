from __future__ import annotations

import asyncio
import logging
import threading
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from memoria.core.pipeline import Pipeline
from memoria.server.deps import get_db, get_pipeline
from memoria.storage.db import DB
from memoria.vault.syncer import VaultSyncer

logger = logging.getLogger(__name__)

router = APIRouter(tags=["vaults"])

_cancel_events: dict[str, threading.Event] = {}


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
        cancel_event = threading.Event()
        _cancel_events[vault["id"]] = cancel_event
        try:
            VaultSyncer(db, pipeline).sync(vault["id"], cancel_event=cancel_event)
        except Exception:
            logger.exception("vault: initial sync failed vault_id=%s", vault["id"])
        finally:
            db.set_vault_syncing(vault["id"], False)
            _cancel_events.pop(vault["id"], None)

    db.set_vault_syncing(vault["id"], True)
    threading.Thread(target=_initial_sync, daemon=True).start()
    return _mask_vault(db.get_vault_by_kb(kb_id))


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
    db: DB = Depends(get_db),
    pipeline: Pipeline = Depends(get_pipeline),
):
    vault = db.get_vault_by_kb(kb_id)
    if vault is None:
        raise HTTPException(status_code=404, detail="No vault bound to this knowledge base")
    if vault["syncing"]:
        raise HTTPException(status_code=409, detail="Vault sync already in progress")

    db.set_vault_syncing(vault["id"], True)

    def _run_sync():
        cancel_event = threading.Event()
        _cancel_events[vault["id"]] = cancel_event
        try:
            VaultSyncer(db, pipeline).sync(vault["id"], cancel_event=cancel_event)
        except Exception:
            logger.exception("vault: manual sync failed vault_id=%s", vault["id"])
        finally:
            db.set_vault_syncing(vault["id"], False)
            _cancel_events.pop(vault["id"], None)

    threading.Thread(target=_run_sync, daemon=True).start()
    return {"status": "sync started"}


@router.delete("/knowledge-bases/{kb_id}/vault/sync", status_code=204)
def cancel_vault_sync(kb_id: str, db: DB = Depends(get_db)):
    vault = db.get_vault_by_kb(kb_id)
    if vault is None:
        raise HTTPException(status_code=404, detail="No vault bound to this knowledge base")
    event = _cancel_events.get(vault["id"])
    if event:
        event.set()


class VaultUpdate(BaseModel):
    auto_sync: Optional[bool] = None


@router.patch("/knowledge-bases/{kb_id}/vault")
def update_vault(kb_id: str, body: VaultUpdate, db: DB = Depends(get_db)):
    vault = db.get_vault_by_kb(kb_id)
    if vault is None:
        raise HTTPException(status_code=404, detail="No vault bound to this knowledge base")
    if body.auto_sync is not None:
        db.update_vault_auto_sync(vault["id"], body.auto_sync)
    return _mask_vault(db.get_vault_by_kb(kb_id))


