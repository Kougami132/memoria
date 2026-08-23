from __future__ import annotations

from typing import Any
from pydantic import BaseModel, Field


class HostConfig(BaseModel):
    id: str
    name: str
    host: str
    port: int = 22
    username: str = "root"
    auth_type: str = "password"  # "password" or "key"
    credential: str = ""  # password or private key (decrypted in-memory)
    description: str = ""
    tags: list[str] = Field(default_factory=list)
    safe_mode: bool = False  # If True, only allow read-only/inspection commands
    status: str = "unknown"
    os_info: str = ""
    created_at: str = ""
    updated_at: str = ""


class HostInfo(BaseModel):
    host_id: str
    name: str
    hostname: str = ""
    os: str = ""
    uptime: str = ""
    cpu_summary: str = ""
    memory_summary: str = ""
    disk_summary: str = ""
    status: str = "online"
    extra: dict[str, Any] = Field(default_factory=dict)


class CommandResult(BaseModel):
    command: str
    exit_code: int
    stdout: str
    stderr: str
    duration_ms: int = 0
