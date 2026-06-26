from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from memoria.core.pipeline import Pipeline
from memoria.server.deps import get_pipeline

router = APIRouter(prefix="/chat", tags=["chat"])


class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None


@router.post("/{bot_id}")
def chat(bot_id: str, body: ChatRequest, pipeline: Pipeline = Depends(get_pipeline)):
    try:
        return pipeline.query(bot_id, body.message, body.session_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
