from fastapi import APIRouter, Depends, HTTPException, Response
from typing import Optional
from pydantic import BaseModel

from memoria.agents.engine import AgenticRagEngine
from memoria.server.deps import get_agentic_engine, get_db
from memoria.storage.db import DB

router = APIRouter(prefix="/sessions", tags=["sessions"])


class SessionUpdate(BaseModel):
    title: str


class SessionTruncate(BaseModel):
    message_id: str
    inclusive: bool = True


class SessionAbort(BaseModel):
    rollback: bool = False
    message_id: Optional[str] = None


@router.get("/{session_id}")
def get_session(session_id: str, db: DB = Depends(get_db)) -> dict:
    session = db.get_session(session_id)
    if session is None or session.get("session_type") != "bot":
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.get("/{session_id}/messages")
def get_messages(
    session_id: str,
    db: DB = Depends(get_db),
    engine: AgenticRagEngine = Depends(get_agentic_engine),
):
    session = db.get_session(session_id)
    if session is None or session.get("session_type") != "bot":
        raise HTTPException(status_code=404, detail="Session not found")
    msgs = db.get_messages_all(session_id)
    if not engine.is_run_active(session_id):
        for m in msgs:
            if m.get("status") == "streaming":
                db.update_message_status(m["id"], status="interrupted")
                m["status"] = "interrupted"
    return msgs


@router.post("/{session_id}/truncate")
def truncate_session_messages(session_id: str, body: SessionTruncate, db: DB = Depends(get_db)):
    session = db.get_session(session_id)
    if session is None or session.get("session_type") != "bot":
        raise HTTPException(status_code=404, detail="Session not found")
    deleted_count = db.truncate_messages_from(session_id, body.message_id, inclusive=body.inclusive)
    return {"session_id": session_id, "deleted_count": deleted_count}


@router.post("/{session_id}/abort")
def abort_session(
    session_id: str,
    body: Optional[SessionAbort] = None,
    engine: AgenticRagEngine = Depends(get_agentic_engine),
    db: DB = Depends(get_db),
):
    session = db.get_session(session_id)
    if session is None or session.get("session_type") != "bot":
        raise HTTPException(status_code=404, detail="Session not found")
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
        # Clean up any leftover streaming messages
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
def update_session(session_id: str, body: SessionUpdate, db: DB = Depends(get_db)):
    existing = db.get_session(session_id)
    if existing is None or existing.get("session_type") != "bot":
        raise HTTPException(status_code=404, detail="Session not found")
    session = db.update_session_title(session_id, body.title)
    return session


@router.delete("/{session_id}", status_code=204)
def delete_session(session_id: str, db: DB = Depends(get_db)):
    session = db.get_session(session_id)
    if session is None or session.get("session_type") != "bot":
        raise HTTPException(status_code=404, detail="Session not found")
    db.delete_session(session_id)
    return Response(status_code=204)
