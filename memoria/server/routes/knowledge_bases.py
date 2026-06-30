import logging
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel

from memoria.core.pipeline import Pipeline
from memoria.server.deps import get_db, get_pipeline
from memoria.storage.db import DB
from memoria.vault.syncer import VaultSyncer

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/knowledge-bases", tags=["knowledge-bases"])


class KBCreate(BaseModel):
    name: str
    description: str = ""
    type: str = "upload"
    vault_type: Optional[str] = None
    local_path: Optional[str] = None
    webdav_url: Optional[str] = None
    webdav_username: Optional[str] = None
    webdav_password: Optional[str] = None


class KBUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


@router.post("", status_code=201)
def create_kb(body: KBCreate, background_tasks: BackgroundTasks,
              db: DB = Depends(get_db), pipeline: Pipeline = Depends(get_pipeline)):
    if body.type not in ("upload", "vault"):
        raise HTTPException(status_code=422, detail="type must be 'upload' or 'vault'")

    if body.vault_type is not None:
        if body.vault_type not in ("local", "webdav"):
            raise HTTPException(status_code=422, detail="vault_type must be 'local' or 'webdav'")
        if body.vault_type == "local" and not body.local_path:
            raise HTTPException(status_code=422, detail="local_path is required for local vault")
        if body.vault_type == "webdav" and not body.webdav_url:
            raise HTTPException(status_code=422, detail="webdav_url is required for webdav vault")
        if body.type != "vault":
            raise HTTPException(status_code=422, detail="vault_type requires type='vault'")

    kb = db.create_kb(body.name, body.description, type=body.type)

    if body.vault_type is not None:
        vault = db.create_vault(
            kb["id"], body.vault_type,
            local_path=body.local_path,
            webdav_url=body.webdav_url,
            webdav_username=body.webdav_username,
            webdav_password=body.webdav_password,
        )

        def _initial_sync():
            try:
                VaultSyncer(db, pipeline).sync(vault["id"])
            except Exception:
                logger.exception("vault: initial sync failed vault_id=%s", vault["id"])

        background_tasks.add_task(_initial_sync)

    return kb


@router.get("")
def list_kbs(db: DB = Depends(get_db)):
    return db.list_kbs()


@router.get("/{kb_id}")
def get_kb(kb_id: str, db: DB = Depends(get_db)):
    kb = db.get_kb(kb_id)
    if kb is None:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    kb["documents"] = db.list_docs(kb_id)
    return kb


@router.delete("/{kb_id}", status_code=204)
def delete_kb(kb_id: str, db: DB = Depends(get_db), pipeline: Pipeline = Depends(get_pipeline)):
    if db.get_kb(kb_id) is None:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    try:
        pipeline._get_store(kb_id)._client.delete_collection(f"kb_{kb_id}")
    except Exception:
        pass
    db.delete_kb(kb_id)


@router.patch("/{kb_id}")
def update_kb(kb_id: str, body: KBUpdate, db: DB = Depends(get_db)):
    kb = db.update_kb(kb_id, name=body.name, description=body.description)
    if kb is None:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    return kb
