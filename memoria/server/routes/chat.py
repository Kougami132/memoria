import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from openai import APIConnectionError, APIError
from pydantic import BaseModel

from memoria.core.pipeline import Pipeline
from memoria.server.deps import get_pipeline

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/chat", tags=["chat"])


class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None


def _json_line(event: dict) -> str:
    return json.dumps(event, ensure_ascii=False) + "\n"


@router.post("/{bot_id}")
def chat(bot_id: str, body: ChatRequest, pipeline: Pipeline = Depends(get_pipeline)):
    try:
        return pipeline.query(bot_id, body.message, body.session_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except APIConnectionError as e:
        raise HTTPException(status_code=503, detail=f"AI service unavailable: {e}")
    except (APIError, RuntimeError) as e:
        logger.error("Chat 502: bot=%s %s: %s", bot_id, type(e).__name__, e)
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/{bot_id}/stream")
def chat_stream(bot_id: str, body: ChatRequest, pipeline: Pipeline = Depends(get_pipeline)):
    def event_stream():
        yield _json_line({"type": "status", "message": "正在检索知识库并构建上下文…"})
        try:
            prepared = pipeline.prepare_query(bot_id, body.message, body.session_id)
        except ValueError as e:
            yield _json_line({"type": "error", "detail": str(e)})
            return
        for event in pipeline.query_stream(prepared):
            yield _json_line(event)

    return StreamingResponse(
        event_stream(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
