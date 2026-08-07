from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel

from memoria.server.deps import get_db
from memoria.storage.db import DB

router = APIRouter(prefix="/sessions", tags=["sessions"])


class SessionUpdate(BaseModel):
    title: str


@router.get("/{session_id}/messages")
def get_messages(session_id: str, db: DB = Depends(get_db)):
    if db.get_session(session_id) is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return db.get_messages_all(session_id)


@router.patch("/{session_id}")
def update_session(session_id: str, body: SessionUpdate, db: DB = Depends(get_db)):
    session = db.update_session_title(session_id, body.title)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.delete("/{session_id}", status_code=204)
def delete_session(session_id: str, db: DB = Depends(get_db)):
    if db.get_session(session_id) is None:
        raise HTTPException(status_code=404, detail="Session not found")
    db.delete_session(session_id)
    return Response(status_code=204)
