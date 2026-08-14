import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
try:
    from openai import APIConnectionError, APIError
except ImportError:  # pragma: no cover - openai is a core dependency in normal installs
    APIConnectionError = ConnectionError
    APIError = RuntimeError
from pydantic import BaseModel

from memoria.agents.engine import AgenticRagEngine, AgenticSdkUnavailable
from memoria.server.deps import get_agentic_engine

logger = logging.getLogger(__name__)
router = APIRouter(tags=["agent-chat"])


class AgentChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None


@router.post("/agent-chat")
def agent_chat(body: AgentChatRequest, engine: AgenticRagEngine = Depends(get_agentic_engine)):
    try:
        return engine.run(
            message=body.message,
            session_id=body.session_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except APIConnectionError as e:
        raise HTTPException(status_code=503, detail=f"AI service unavailable: {e}")
    except (AgenticSdkUnavailable, APIError, RuntimeError) as e:
        logger.error("Agentic chat 502: %s: %s", type(e).__name__, e)
        raise HTTPException(status_code=502, detail=str(e))
