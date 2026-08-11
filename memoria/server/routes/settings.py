import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from memoria.config import get_effective_settings
from memoria.core.embedder import Embedder
from memoria.llm.caller import LLMCaller
from memoria.server.deps import get_db, reset_pipeline
from memoria.storage.db import DB

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/settings", tags=["settings"])


class SettingsUpdate(BaseModel):
    openai_base_url: Optional[str] = None
    api_key: Optional[str] = None
    embedding_model: Optional[str] = None
    llm_model: Optional[str] = None
    system_prompt: Optional[str] = None
    top_k: Optional[int] = None
    min_score: Optional[float] = None
    chunk_size: Optional[int] = None
    chunk_overlap: Optional[int] = None
    vault_sync_interval_minutes: Optional[int] = None


@router.get("")
def get_settings(db: DB = Depends(get_db)):
    return get_effective_settings(db)


@router.put("")
def update_settings(body: SettingsUpdate, request: Request, db: DB = Depends(get_db)):
    if body.vault_sync_interval_minutes is not None and body.vault_sync_interval_minutes < 1:
        raise HTTPException(status_code=422, detail="vault_sync_interval_minutes must be >= 1")
    mapping = {
        "openai_base_url": body.openai_base_url,
        "openai_api_key": body.api_key,
        "embedding_model": body.embedding_model,
        "llm_model": body.llm_model,
        "system_prompt": body.system_prompt,
        "top_k": str(body.top_k) if body.top_k is not None else None,
        "min_score": str(body.min_score) if body.min_score is not None else None,
        "chunk_size": str(body.chunk_size) if body.chunk_size is not None else None,
        "chunk_overlap": str(body.chunk_overlap) if body.chunk_overlap is not None else None,
        "vault_sync_interval_minutes": str(body.vault_sync_interval_minutes) if body.vault_sync_interval_minutes is not None else None,
    }
    changed = False
    for key, value in mapping.items():
        if value is None:
            continue
        if value == "":
            db.delete_setting(key)
        else:
            db.set_setting(key, value)
        changed = True
    if changed:
        reset_pipeline()
    if changed and body.vault_sync_interval_minutes is not None:
        scheduler = getattr(request.app.state, "scheduler", None)
        if scheduler and scheduler.running:
            try:
                minutes = int(db.get_setting("vault_sync_interval_minutes") or 15)
                scheduler.reschedule_job("vault_poll", trigger="interval", minutes=minutes)
            except Exception as exc:
                logger.warning("settings: failed to reschedule vault_poll: %s", exc)
    return get_effective_settings(db)


@router.post("/test-embedding")
def test_embedding(db: DB = Depends(get_db)):
    effective = get_effective_settings(db)
    embedder = Embedder(effective["openai_base_url"], effective["openai_api_key"],
                        effective["embedding_model"])
    try:
        vec = embedder.embed(["test"])
        return {"ok": True, "dimensions": len(vec[0])}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/test-chat")
def test_chat(db: DB = Depends(get_db)):
    import time
    effective = get_effective_settings(db)
    llm = LLMCaller(effective["openai_base_url"], effective["openai_api_key"],
                    effective["llm_model"])
    try:
        t0 = time.monotonic()
        llm.call([{"role": "user", "content": "hi"}])
        elapsed_ms = round((time.monotonic() - t0) * 1000)
        return {"ok": True, "elapsed_ms": elapsed_ms}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
