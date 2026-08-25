from __future__ import annotations

import logging
from typing import Any
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from memoria.connectors.base import ResourceType
from memoria.connectors.host.connector import HostConnector
from memoria.connectors.host.models import HostConfig
from memoria.server.deps import get_db, get_registry
from memoria.storage.db import DB
from memoria.connectors.registry import ConnectorRegistry

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/hosts", tags=["hosts"])


class HostCreate(BaseModel):
    name: str = Field(..., min_length=1)
    host: str = Field(..., min_length=1)
    port: int = Field(default=22, ge=1, le=65535)
    username: str = Field(default="root")
    auth_type: str = Field(default="password")  # "password" or "key"
    credential: str = Field(default="")
    description: str = Field(default="")
    tags: list[str] = Field(default_factory=list)
    safe_mode: bool = Field(default=False)
    security_mode: str | None = Field(default=None)  # "read_only", "ask_confirmation", "unrestricted"


class HostUpdate(BaseModel):
    name: str | None = None
    host: str | None = None
    port: int | None = Field(default=None, ge=1, le=65535)
    username: str | None = None
    auth_type: str | None = None
    credential: str | None = None
    description: str | None = None
    tags: list[str] | None = None
    safe_mode: bool | None = None
    security_mode: str | None = None
    os_info: str | None = None
    status: str | None = None


class HostOut(BaseModel):
    id: str
    name: str
    host: str
    port: int
    username: str
    auth_type: str
    credential_set: bool = False
    description: str
    tags: list[str]
    safe_mode: bool = False
    security_mode: str = "read_only"
    os_info: str
    status: str
    created_at: str
    updated_at: str


def _to_host_out(h: dict[str, Any]) -> dict[str, Any]:
    out = dict(h)
    out["credential_set"] = bool(h.get("credential"))
    if "credential" in out:
        del out["credential"]
    return out


@router.get("", response_model=list[HostOut])
def list_hosts(db: DB = Depends(get_db)) -> list[dict[str, Any]]:
    hosts = db.list_hosts(decrypt=False)
    return [_to_host_out(h) for h in hosts]


@router.post("", response_model=HostOut, status_code=201)
def create_host(
    payload: HostCreate,
    db: DB = Depends(get_db),
    registry: ConnectorRegistry = Depends(get_registry),
) -> dict[str, Any]:
    sec_mode = payload.security_mode or ("read_only" if payload.safe_mode else "ask_confirmation")
    host_dict = db.create_host(
        name=payload.name,
        host=payload.host,
        port=payload.port,
        username=payload.username,
        auth_type=payload.auth_type,
        credential=payload.credential,
        description=payload.description,
        tags=payload.tags,
        safe_mode=(sec_mode == "read_only"),
        security_mode=sec_mode,
    )
    # Register connector in runtime registry with decrypted credential
    config = HostConfig(**host_dict)
    connector = HostConnector(config)
    registry.register(connector)
    return _to_host_out(host_dict)


@router.get("/{host_id}", response_model=HostOut)
def get_host(host_id: str, db: DB = Depends(get_db)) -> dict[str, Any]:
    host = db.get_host(host_id, decrypt=False)
    if not host:
        raise HTTPException(status_code=404, detail="Host not found")
    return _to_host_out(host)


@router.put("/{host_id}", response_model=HostOut)
def update_host(
    host_id: str,
    payload: HostUpdate,
    db: DB = Depends(get_db),
    registry: ConnectorRegistry = Depends(get_registry),
) -> dict[str, Any]:
    # If credential was not provided or empty string, do not overwrite if None
    sec_mode = payload.security_mode
    if sec_mode is None and payload.safe_mode is not None:
        sec_mode = "read_only" if payload.safe_mode else "unrestricted"

    host = db.update_host(
        host_id=host_id,
        name=payload.name,
        host=payload.host,
        port=payload.port,
        username=payload.username,
        auth_type=payload.auth_type,
        credential=payload.credential,
        description=payload.description,
        tags=payload.tags,
        safe_mode=(sec_mode == "read_only") if sec_mode is not None else payload.safe_mode,
        security_mode=sec_mode,
        os_info=payload.os_info,
        status=payload.status,
    )
    if not host:
        raise HTTPException(status_code=404, detail="Host not found")
    
    # Update registry
    config = HostConfig(**host)
    connector = HostConnector(config)
    registry.register(connector)
    return _to_host_out(host)


@router.delete("/{host_id}", status_code=204)
def delete_host(
    host_id: str,
    db: DB = Depends(get_db),
    registry: ConnectorRegistry = Depends(get_registry),
) -> None:
    deleted = db.delete_host(host_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Host not found")
    registry.unregister(ResourceType.HOST, host_id)


@router.post("/{host_id}/test")
def test_host_connection(
    host_id: str,
    db: DB = Depends(get_db),
    registry: ConnectorRegistry = Depends(get_registry),
) -> dict[str, Any]:
    host = db.get_host(host_id, decrypt=True)
    if not host:
        raise HTTPException(status_code=404, detail="Host not found")
    
    config = HostConfig(**host)
    conn = HostConnector(config)
    registry.register(conn)
        
    result = conn.test_connection()
    result["ok"] = (result.get("status") == "success")
    new_status = "active" if result.get("status") == "success" else "error"
    db.update_host(host_id, status=new_status)
    return result


class ApprovalRespondRequest(BaseModel):
    approved: bool


@router.post("/approvals/{approval_id}/respond")
def respond_approval(
    approval_id: str,
    body: ApprovalRespondRequest,
    db: DB = Depends(get_db),
) -> dict[str, Any]:
    from memoria.connectors.host.approval import global_host_approval_manager
    approval = global_host_approval_manager.respond(approval_id, approved=body.approved)
    if not approval:
        raise HTTPException(status_code=404, detail="Approval request not found or expired")
    new_status = "approved" if body.approved else "rejected"
    db.update_approval_message_status(approval_id, new_status)
    return {
        "id": approval.id,
        "status": approval.status,
        "command": approval.command,
        "host_id": approval.host_id,
    }


@router.get("/approvals/{approval_id}")
def get_approval(approval_id: str) -> dict[str, Any]:
    from memoria.connectors.host.approval import global_host_approval_manager
    approval = global_host_approval_manager.get_approval(approval_id)
    if not approval:
        raise HTTPException(status_code=404, detail="Approval request not found")
    return {
        "id": approval.id,
        "host_id": approval.host_id,
        "host_name": approval.host_name,
        "command": approval.command,
        "status": approval.status,
        "created_at": approval.created_at,
    }
