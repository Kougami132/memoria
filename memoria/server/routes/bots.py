from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from memoria.server.deps import get_db
from memoria.storage.db import DB

router = APIRouter(prefix="/bots", tags=["bots"])


class BotCreate(BaseModel):
    name: str
    system_prompt: str = ""
    kb_ids: list[str] = []
    host_ids: list[str] = []
    model_override: Optional[str] = None


class BotUpdate(BaseModel):
    name: Optional[str] = None
    system_prompt: Optional[str] = None
    kb_ids: Optional[list[str]] = None
    host_ids: Optional[list[str]] = None
    model_override: Optional[str] = None


@router.post("", status_code=201)
def create_bot(body: BotCreate, db: DB = Depends(get_db)):
    return db.create_bot(
        name=body.name,
        system_prompt=body.system_prompt,
        kb_ids=body.kb_ids,
        host_ids=body.host_ids,
        model_override=body.model_override,
    )


@router.get("")
def list_bots(db: DB = Depends(get_db)):
    return db.list_bots()


@router.get("/{bot_id}")
def get_bot(bot_id: str, db: DB = Depends(get_db)):
    bot = db.get_bot(bot_id)
    if bot is None:
        raise HTTPException(status_code=404, detail="Bot not found")
    return bot


@router.put("/{bot_id}")
def update_bot(bot_id: str, body: BotUpdate, db: DB = Depends(get_db)):
    bot = db.update_bot(
        bot_id=bot_id,
        name=body.name,
        system_prompt=body.system_prompt,
        kb_ids=body.kb_ids,
        host_ids=body.host_ids,
        model_override=body.model_override,
    )
    if bot is None:
        raise HTTPException(status_code=404, detail="Bot not found")
    return bot


@router.delete("/{bot_id}", status_code=204)
def delete_bot(bot_id: str, db: DB = Depends(get_db)):
    if db.get_bot(bot_id) is None:
        raise HTTPException(status_code=404, detail="Bot not found")
    db.delete_bot(bot_id)


@router.get("/{bot_id}/sessions")
def list_bot_sessions(bot_id: str, db: DB = Depends(get_db)):
    if db.get_bot(bot_id) is None:
        raise HTTPException(status_code=404, detail="Bot not found")
    return db.list_sessions(bot_id=bot_id)
