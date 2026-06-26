from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from memoria.server.deps import get_db, get_pipeline
from memoria.storage.db import DB
from memoria.core.pipeline import Pipeline

router = APIRouter(prefix="/knowledge-bases", tags=["knowledge-bases"])


class KBCreate(BaseModel):
    name: str
    description: str = ""


@router.post("", status_code=201)
def create_kb(body: KBCreate, db: DB = Depends(get_db)):
    return db.create_kb(body.name, body.description)


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
