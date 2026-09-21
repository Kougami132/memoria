import os
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, UploadFile, status
from openai import APIConnectionError, APIError

from memoria.config import settings
from memoria.core.pipeline import Pipeline
from memoria.server.deps import get_db, get_pipeline, get_task_queue
from memoria.storage.db import DB
from memoria.tasks.base import BaseTaskQueue

router = APIRouter(tags=["documents"])

from memoria.core.chunker import SUPPORTED as ALLOWED_SUFFIXES


@router.post("/knowledge-bases/{kb_id}/documents")
async def upload_document(kb_id: str, file: UploadFile,
                          response: Response,
                          async_mode: bool = Query(default=True),
                          db: DB = Depends(get_db),
                          pipeline: Pipeline = Depends(get_pipeline),
                          task_queue: BaseTaskQueue = Depends(get_task_queue)):
    if db.get_kb(kb_id) is None:
        raise HTTPException(status_code=404, detail="Knowledge base not found")
    kb = db.get_kb(kb_id)
    if kb["type"] != "upload":
        raise HTTPException(status_code=409, detail="Vault-type knowledge bases do not accept manual uploads")

    suffix = os.path.splitext(file.filename or "")[1].lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(status_code=422, detail=f"Unsupported file format: {suffix}")

    save_dir = os.path.join(settings.upload_dir, kb_id)
    os.makedirs(save_dir, exist_ok=True)
    save_path = os.path.join(save_dir, file.filename)

    content = await file.read()
    with open(save_path, "wb") as f:
        f.write(content)

    if async_mode:
        response.status_code = status.HTTP_202_ACCEPTED
        task_id = await task_queue.enqueue(
            "document_ingest",
            {"kb_id": kb_id, "file_path": save_path, "filename": file.filename},
        )
        return {
            "task_id": task_id,
            "status": "pending",
            "message": "Document uploaded and indexing task enqueued",
        }

    response.status_code = status.HTTP_201_CREATED
    try:
        return pipeline.ingest(kb_id, save_path)
    except APIConnectionError as e:
        raise HTTPException(status_code=503, detail=f"Embedding service unavailable: {e}")
    except (APIError, RuntimeError) as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/knowledge-bases/{kb_id}/documents")
def list_kb_documents(kb_id: str, db: DB = Depends(get_db)):
    return db.list_docs(kb_id)


@router.get("/documents")
def list_documents(kb_id: Optional[str] = None, db: DB = Depends(get_db)):
    if kb_id:
        return db.list_docs(kb_id)
    # Return all docs across all KBs
    all_docs = []
    for kb in db.list_kbs():
        all_docs.extend(db.list_docs(kb["id"]))
    return all_docs


@router.delete("/documents/{doc_id}", status_code=204)
def delete_document(doc_id: str, db: DB = Depends(get_db), pipeline: Pipeline = Depends(get_pipeline)):
    doc = db.get_doc(doc_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    if doc.get("source") == "vault":
        raise HTTPException(status_code=409, detail="Vault-sourced documents cannot be manually deleted. Unbind the vault to remove them.")
    pipeline.delete_doc(doc_id, doc["kb_id"])
