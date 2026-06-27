from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from memoria.config import get_effective_settings
from memoria.server.deps import get_db, reset_pipeline
from memoria.storage.db import DB

router = APIRouter(prefix="/settings", tags=["settings"])


class SettingsUpdate(BaseModel):
    openai_base_url: Optional[str] = None
    api_key: Optional[str] = None
    embedding_model: Optional[str] = None
    llm_model: Optional[str] = None
    top_k: Optional[int] = None
    chunk_size: Optional[int] = None
    chunk_overlap: Optional[int] = None


@router.get("")
def get_settings(db: DB = Depends(get_db)):
    return get_effective_settings(db)


@router.put("")
def update_settings(body: SettingsUpdate, db: DB = Depends(get_db)):
    mapping = {
        "openai_base_url": body.openai_base_url,
        "openai_api_key": body.api_key,
        "embedding_model": body.embedding_model,
        "llm_model": body.llm_model,
        "top_k": str(body.top_k) if body.top_k is not None else None,
        "chunk_size": str(body.chunk_size) if body.chunk_size is not None else None,
        "chunk_overlap": str(body.chunk_overlap) if body.chunk_overlap is not None else None,
    }
    changed = False
    for key, value in mapping.items():
        if value is not None and value != "":
            db.set_setting(key, value)
            changed = True
    if changed:
        reset_pipeline()
    return get_effective_settings(db)
