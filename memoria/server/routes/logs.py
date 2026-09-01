import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel

from memoria.server.deps import get_db
from memoria.storage.db import DB

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/logs", tags=["logs"])


@router.get("/invocations")
def list_invocation_logs(
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: DB = Depends(get_db),
):
    items = db.list_api_invocations(limit=limit, offset=offset)
    return {
        "items": items,
        "limit": limit,
        "offset": offset,
    }


@router.delete("/invocations", status_code=204)
def clear_invocation_logs(db: DB = Depends(get_db)):
    db.clear_api_invocations()
    return Response(status_code=204)


@router.get("/system")
def get_system_logs():
    """Placeholder endpoint for system logs (reserved for future implementation)."""
    return {
        "status": "ok",
        "placeholder": True,
        "message": "系统日志模块预留中，暂未启用具体功能。",
        "items": [],
    }
