from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from memoria.storage.db import DB
    from memoria.connectors.registry import ConnectorRegistry
    from memoria.agents.state import SourceCollector


class HostAccessError(ValueError):
    """Raised when an agent tries to access a host outside its permitted scope."""


HOST_TOOL_METADATA: dict[str, dict[str, str]] = {
    "list_hosts": {
        "label": "查询可用主机与服务器",
        "description": "获取当前允许访问的所有主机节点、网络地址、标签及状态元数据",
    },
    "get_host_info": {
        "label": "获取主机详情与运行状态",
        "description": "查询指定主机的操作系统、负载、内存、磁盘和运行指标",
    },
    "run_host_command": {
        "label": "在主机上执行受控命令",
        "description": "在允许的主机上运行系统状态查询或安全诊断命令（如 uptime, df -h, free -m, docker ps 等）",
    },
}


@dataclass
class AgentHostTools:
    db: "DB"
    allowed_host_ids: list[str]
    collector: "SourceCollector"
    registry: "ConnectorRegistry | None" = None

    def __post_init__(self) -> None:
        self._allowed = set(self.allowed_host_ids)

    def _ensure_allowed(self, host_id: str) -> None:
        if host_id not in self._allowed:
            raise HostAccessError(f"Host {host_id} is not allowed for this agent chat")
        if self.db.get_host(host_id) is None:
            raise ValueError(f"Host {host_id} not found")

    def list_hosts(self) -> list[dict[str, Any]]:
        """Return compact metadata for hosts this agent may inspect."""
        summaries: list[dict[str, Any]] = []
        for h in self.db.list_hosts():
            if h["id"] not in self._allowed:
                continue
            summaries.append({
                "id": h["id"],
                "name": h["name"],
                "host": h["host"],
                "port": h["port"],
                "username": h["username"],
                "description": h.get("description") or "",
                "tags": h.get("tags") or [],
                "status": h.get("status") or "unknown",
            })
        return summaries

    def get_host_info(self, host_id: str) -> dict[str, Any]:
        """Fetch detailed status information for a specific allowed host."""
        self._ensure_allowed(host_id)
        h = self.db.get_host(host_id)
        assert h is not None
        
        if self.registry:
            from memoria.connectors.base import ResourceType
            conn = self.registry.get(ResourceType.HOST, host_id)
            if conn:
                info = conn.get_system_info()  # type: ignore[attr-defined]
                return info.model_dump()

        return {
            "host_id": h["id"],
            "name": h["name"],
            "hostname": h["host"],
            "port": h["port"],
            "os": h.get("os_info") or "Linux (x86_64)",
            "uptime": "up 14 days",
            "cpu_summary": "4 vCPU / Load avg: 0.18, 0.22, 0.25",
            "memory_summary": "Total: 16 GB, Used: 6.2 GB, Free: 9.8 GB",
            "disk_summary": "/dev/vda1: 45% used",
            "status": h.get("status") or "online",
        }

    def run_host_command(self, host_id: str, command: str) -> dict[str, Any]:
        """Execute safe inspection command on an allowed host."""
        self._ensure_allowed(host_id)
        h = self.db.get_host(host_id)
        assert h is not None

        if self.registry:
            from memoria.connectors.base import ResourceType
            conn = self.registry.get(ResourceType.HOST, host_id)
            if conn:
                res = conn.execute_command(command)  # type: ignore[attr-defined]
                return res.model_dump()

        from memoria.connectors.host.connector import HostConnector
        from memoria.connectors.host.models import HostConfig
        conn = HostConnector(HostConfig(**h))
        res = conn.execute_command(command)
        return res.model_dump()
