from fastapi import APIRouter, Depends, HTTPException, Response
from typing import Optional
from pydantic import BaseModel

from memoria.agents.engine import AgenticRagEngine
from memoria.server.deps import get_agentic_engine, get_db
from memoria.storage.db import DB

router = APIRouter(prefix="/agent-sessions", tags=["agent-sessions"])


class AgentSessionUpdate(BaseModel):
    title: str


class AgentSessionTruncate(BaseModel):
    message_id: str
    inclusive: bool = True


class AgentSessionAbort(BaseModel):
    rollback: bool = False
    message_id: Optional[str] = None


@router.get("")
def list_agent_sessions(db: DB = Depends(get_db)):
    return db.list_agentic_sessions()


@router.get("/{session_id}/messages")
def get_agent_messages(
    session_id: str,
    db: DB = Depends(get_db),
    engine: AgenticRagEngine = Depends(get_agentic_engine),
):
    if db.get_agentic_session(session_id) is None:
        raise HTTPException(status_code=404, detail="Agentic session not found")
    msgs = db.get_messages_all(session_id)
    if not engine.is_run_active(session_id):
        for m in msgs:
            if m.get("status") == "streaming":
                db.update_message_status(m["id"], status="interrupted")
                m["status"] = "interrupted"
    return msgs


@router.post("/{session_id}/truncate")
def truncate_agent_session_messages(session_id: str, body: AgentSessionTruncate, db: DB = Depends(get_db)):
    if db.get_agentic_session(session_id) is None:
        raise HTTPException(status_code=404, detail="Agentic session not found")
    deleted_count = db.truncate_messages_from(session_id, body.message_id, inclusive=body.inclusive)
    return {"session_id": session_id, "deleted_count": deleted_count}


@router.post("/{session_id}/abort")
def abort_agent_session(
    session_id: str,
    body: Optional[AgentSessionAbort] = None,
    engine: AgenticRagEngine = Depends(get_agentic_engine),
    db: DB = Depends(get_db),
):
    if db.get_agentic_session(session_id) is None:
        raise HTTPException(status_code=404, detail="Agentic session not found")
    aborted = engine.cancel_run(session_id)
    if body and body.rollback:
        target_msg_id = body.message_id
        if not target_msg_id:
            msgs = db.get_messages_all(session_id)
            for m in reversed(msgs):
                if m.get("role") == "user":
                    target_msg_id = m["id"]
                    break
        if target_msg_id:
            db.truncate_messages_from(session_id, target_msg_id, inclusive=True)
        for m in db.get_messages_all(session_id):
            if m.get("status") == "streaming":
                db.update_message_status(m["id"], status="interrupted")
    else:
        msgs = db.get_messages_all(session_id)
        for m in reversed(msgs):
            if m.get("status") in ("streaming", "pending_approval"):
                db.update_message_status(m["id"], status="interrupted")
                break
    return {"session_id": session_id, "aborted": aborted}


@router.patch("/{session_id}")
def update_agent_session(session_id: str, body: AgentSessionUpdate, db: DB = Depends(get_db)):
    session = db.update_agentic_session_title(session_id, body.title)
    if session is None:
        raise HTTPException(status_code=404, detail="Agentic session not found")
    return session


@router.delete("/{session_id}", status_code=204)
def delete_agent_session(session_id: str, db: DB = Depends(get_db)):
    if db.get_agentic_session(session_id) is None:
        raise HTTPException(status_code=404, detail="Agentic session not found")
    db.delete_session(session_id)
    return Response(status_code=204)
