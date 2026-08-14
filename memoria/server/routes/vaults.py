from __future__ import annotations

import logging
import os
import threading
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from memoria.core.pipeline import Pipeline
from memoria.server.deps import get_db, get_pipeline
from memoria.storage.db import DB
from memoria.vault.connector import WebDAVConnector, _normalize_webdav_path
from memoria.vault.syncer import VaultSyncer

logger = logging.getLogger(__name__)

router = APIRouter(tags=["vaults"])

_cancel_events: dict[str, threading.Event] = {}


class VaultCreate(BaseModel):
    type: str
    local_path: Optional[str] = None
    webdav_url: Optional[str] = None
    webdav_path: Optional[str] = None
    webdav_username: Optional[str] = None
    webdav_password: Optional[str] = None


class LocalPathBrowseRequest(BaseModel):
    path: Optional[str] = None


class WebDAVBrowseRequest(BaseModel):
    webdav_url: str
    webdav_username: Optional[str] = None
    webdav_password: Optional[str] = None
    path: Optional[str] = "/"


class WebDAVTestRequest(BaseModel):
    webdav_url: str
    webdav_path: Optional[str] = "/"
    webdav_username: Optional[str] = None
    webdav_password: Optional[str] = None


def _validate_vault_create(body: VaultCreate) -> None:
    if body.type not in ("local", "webdav"):
        raise HTTPException(status_code=422, detail="type must be 'local' or 'webdav'")
    if body.type == "local" and not (body.local_path or "").strip():
        raise HTTPException(status_code=422, detail="local_path is required for local vault")
    if body.type == "webdav" and not (body.webdav_url or "").strip():
        raise HTTPException(status_code=422, detail="webdav_url is required for webdav vault")


def _local_browse_start(path: str | None) -> Path:
    if path and path.strip():
        return Path(path).expanduser().resolve()
    home = Path.home()
    return home if home.exists() else Path.cwd().resolve()


def _local_dir_entry(path: Path) -> dict:
    return {"name": path.name or str(path), "path": str(path), "type": "directory"}


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

    _validate_vault_create(body)
    try:
        vault = db.create_vault(
            kb_id, body.type,
            local_path=body.local_path,
            webdav_url=body.webdav_url,
            webdav_path=body.webdav_path or "/",
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


@router.post("/vaults/browse-local")
def browse_local_path(body: LocalPathBrowseRequest):
    try:
        current = _local_browse_start(body.path)
        if not current.exists():
            raise HTTPException(status_code=404, detail="Local path not found")
        if not current.is_dir():
            current = current.parent
        entries = []
        for child in current.iterdir():
            try:
                if child.is_dir():
                    entries.append(_local_dir_entry(child))
            except OSError:
                continue
        entries.sort(key=lambda item: item["name"].casefold())
        parent = str(current.parent) if current.parent != current else None
        return {"path": str(current), "parent": parent, "entries": entries}
    except HTTPException:
        raise
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except OSError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/vaults/browse-webdav")
def browse_webdav_path(body: WebDAVBrowseRequest):
    if not body.webdav_url.strip():
        raise HTTPException(status_code=422, detail="webdav_url is required")
    path = _normalize_webdav_path(body.path)
    try:
        connector = WebDAVConnector(body.webdav_url.strip(), body.webdav_username, body.webdav_password, "/")
        dirs = connector.list_dirs(path)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"WebDAV browse failed: {e}")
    parent = None
    if path != "/":
        parent = os.path.dirname(path.rstrip("/")) or "/"
    return {
        "path": path,
        "parent": parent,
        "entries": [{"name": os.path.basename(p.rstrip("/")) or p, "path": p, "type": "directory"} for p in dirs],
    }


@router.post("/vaults/test-webdav")
def test_webdav(body: WebDAVTestRequest):
    if not body.webdav_url.strip():
        raise HTTPException(status_code=422, detail="webdav_url is required")
    try:
        connector = WebDAVConnector(
            body.webdav_url.strip(),
            body.webdav_username,
            body.webdav_password,
            body.webdav_path or "/",
        )
        files = connector.list_files()
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"WebDAV test failed: {e}")
    return {"ok": True, "file_count": len(files), "path": _normalize_webdav_path(body.webdav_path)}


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


