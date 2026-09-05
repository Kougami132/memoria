import logging
import os
import re
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse
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


@router.get("/qqbot/status")
def get_qqbot_status(request: Request, db: DB = Depends(get_db)):
    adapter = getattr(request.app.state, "qq_adapter", None)
    status = getattr(adapter, "status", "disabled") if adapter else "disabled"
    last_error = getattr(adapter, "last_error", None) if adapter else None
    stats = db.get_qqbot_stats()
    return {
        "status": status,
        "last_error": last_error,
        "stats": stats,
    }


@router.get("/qqbot/events")
def list_qqbot_events(
    category: Optional[str] = Query(None),
    level: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: DB = Depends(get_db),
):
    items = db.list_qqbot_logs(limit=limit, offset=offset, category=category, level=level)
    stats = db.get_qqbot_stats()
    return {
        "items": items,
        "limit": limit,
        "offset": offset,
        "stats": stats,
    }


@router.delete("/qqbot/events", status_code=204)
def clear_qqbot_events(
    category: Optional[str] = Query(None),
    db: DB = Depends(get_db),
):
    db.clear_qqbot_logs(category=category)
    return Response(status_code=204)


def _get_log_file_path() -> str:
    candidates = [
        os.path.join(os.getcwd(), "data", "memoria.log"),
        os.path.abspath("data/memoria.log"),
    ]
    for p in candidates:
        if os.path.exists(p):
            return p
    return candidates[0]


def _tail_lines(file_path: str, max_lines: int = 500, buffer_size: int = 512 * 1024) -> list[str]:
    if not os.path.exists(file_path):
        return []
    try:
        with open(file_path, "rb") as f:
            f.seek(0, os.SEEK_END)
            file_size = f.tell()
            read_size = min(file_size, buffer_size)
            f.seek(file_size - read_size)
            chunk = f.read(read_size).decode("utf-8", errors="replace")
            lines = chunk.splitlines()
            return lines[-max_lines:]
    except Exception as e:
        logger.warning("Failed to tail log file %s: %s", file_path, e)
        return []


_LOG_LINE_RE = re.compile(
    r"^(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?)\s+(INFO|WARNING|WARN|ERROR|DEBUG|CRITICAL)\s+(.*?)\s*—\s*(.*)$"
)


@router.get("/system")
def get_system_logs(
    lines: int = Query(200, ge=10, le=1000),
    level: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
):
    log_path = _get_log_file_path()
    if not os.path.exists(log_path):
        return {
            "status": "ok",
            "file_exists": False,
            "items": [],
            "total": 0,
            "message": "日志文件 data/memoria.log 尚未生成",
        }

    raw_lines = _tail_lines(log_path, max_lines=lines * 3)
    parsed_items: list[dict[str, Any]] = []

    current_item: dict[str, Any] | None = None
    for line in raw_lines:
        m = _LOG_LINE_RE.match(line)
        if m:
            if current_item:
                parsed_items.append(current_item)
            ts, lvl, comp, msg = m.groups()
            std_lvl = "WARN" if lvl == "WARNING" else lvl
            current_item = {
                "timestamp": ts,
                "level": std_lvl,
                "component": comp.strip(),
                "message": msg.strip(),
                "raw": line,
            }
        else:
            if current_item:
                current_item["message"] += f"\n{line}"
                current_item["raw"] += f"\n{line}"
            else:
                parsed_items.append({
                    "timestamp": "",
                    "level": "INFO",
                    "component": "",
                    "message": line,
                    "raw": line,
                })
    if current_item:
        parsed_items.append(current_item)

    if level and level.upper() != "ALL":
        target_lvl = "WARN" if level.upper() in {"WARN", "WARNING"} else level.upper()
        parsed_items = [it for it in parsed_items if it.get("level") == target_lvl]

    if search and search.strip():
        kw = search.strip().lower()
        parsed_items = [
            it for it in parsed_items
            if kw in it.get("message", "").lower()
            or kw in it.get("component", "").lower()
            or kw in it.get("raw", "").lower()
        ]

    result_items = parsed_items[-lines:]
    return {
        "status": "ok",
        "file_exists": True,
        "file_size": os.path.getsize(log_path),
        "items": result_items,
        "total": len(result_items),
    }


@router.get("/system/download")
def download_system_logs():
    log_path = _get_log_file_path()
    if not os.path.exists(log_path):
        raise HTTPException(status_code=404, detail="Log file data/memoria.log does not exist")
    return FileResponse(
        path=log_path,
        filename="memoria.log",
        media_type="text/plain; charset=utf-8",
    )
