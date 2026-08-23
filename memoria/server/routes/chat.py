import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
try:
    from openai import APIConnectionError, APIError
except ImportError:  # pragma: no cover
    APIConnectionError = ConnectionError
    APIError = RuntimeError
from pydantic import BaseModel

from memoria.agents.engine import AgenticRagEngine, AgenticSdkUnavailable
from memoria.server.deps import get_agentic_engine

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/chat", tags=["chat"])


class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None


def _json_line(event: dict) -> str:
    return json.dumps(event, ensure_ascii=False) + "\n"


@router.post("/{bot_id}")
def chat(bot_id: str, body: ChatRequest, engine: AgenticRagEngine = Depends(get_agentic_engine)):
    try:
        return engine.run(
            message=body.message,
            session_id=body.session_id,
            bot_id=bot_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except APIConnectionError as e:
        raise HTTPException(status_code=503, detail=f"AI service unavailable: {e}")
    except (AgenticSdkUnavailable, APIError, RuntimeError) as e:
        logger.error("Chat 502: bot=%s %s: %s", bot_id, type(e).__name__, e)
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/{bot_id}/stream")
def chat_stream(bot_id: str, body: ChatRequest, engine: AgenticRagEngine = Depends(get_agentic_engine)):
    def event_stream():
        try:
            for event in engine.run_stream(
                message=body.message,
                session_id=body.session_id,
                bot_id=bot_id,
            ):
                yield _json_line(event)
        except ValueError as e:
            yield _json_line({"type": "error", "detail": str(e)})
        except APIConnectionError as e:
            yield _json_line({"type": "error", "detail": f"AI service unavailable: {e}"})
        except Exception as e:
            logger.exception("Chat stream error: bot=%s %s", bot_id, e)
            yield _json_line({"type": "error", "detail": str(e)})

    return StreamingResponse(
        event_stream(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
