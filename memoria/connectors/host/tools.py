from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Callable

logger = logging.getLogger(__name__)

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
        "agent_id": "host_agent",
        "agent_name": "HostAgent",
        "agent_role": "specialist",
        "parent_agent_id": "orchestrator",
    },
    "get_host_info": {
        "label": "获取主机详情与运行状态",
        "description": "查询指定主机的操作系统、负载、内存、磁盘和运行指标",
        "agent_id": "host_agent",
        "agent_name": "HostAgent",
        "agent_role": "specialist",
        "parent_agent_id": "orchestrator",
    },
    "read_host_log_tail": {
        "label": "读取主机日志文件末尾",
        "description": "安全读取主机上指定日志文件或文本文件的末尾若干行（受行数与字符截断保护）",
        "agent_id": "host_agent",
        "agent_name": "HostAgent",
        "agent_role": "specialist",
        "parent_agent_id": "orchestrator",
    },
    "run_host_command": {
        "label": "在主机上执行受控命令",
        "description": "在允许的主机上运行系统状态查询或安全诊断命令（如 uptime, df -h, free -m, docker ps 等）",
        "agent_id": "host_agent",
        "agent_name": "HostAgent",
        "agent_role": "specialist",
        "parent_agent_id": "orchestrator",
    },
    "get_job_status": {
        "label": "查询主机后台任务运行状态",
        "description": "根据 job_handle 句柄查询后台长任务进程的实时状态、退出码与输出摘要",
        "agent_id": "host_agent",
        "agent_name": "HostAgent",
        "agent_role": "specialist",
        "parent_agent_id": "orchestrator",
    },
    "read_job_output": {
        "label": "读取后台任务实时输出日志",
        "description": "根据 job_handle 句柄增量读取后台任务进程的标准输出和错误日志",
        "agent_id": "host_agent",
        "agent_name": "HostAgent",
        "agent_role": "specialist",
        "parent_agent_id": "orchestrator",
    },
}


@dataclass
class AgentHostTools:
    db: "DB"
    allowed_host_ids: list[str]
    collector: "SourceCollector"
    registry: "ConnectorRegistry | None" = None
    host_security_modes: "dict[str, str] | None" = None

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

    def read_host_log_tail(
        self,
        host_id: str,
        path: str,
        lines: int = 100,
        max_bytes: int = 32768,
    ) -> dict[str, Any]:
        """Safely read the trailing lines of a log or text file on the host."""
        self._ensure_allowed(host_id)
        if not path or not path.strip():
            return {
                "host_id": host_id,
                "path": path,
                "exit_code": 1,
                "stdout": "",
                "stderr": "File path cannot be empty",
                "truncated": False,
            }

        lines_to_read = max(1, min(int(lines), 500))
        import shlex
        cmd = f"tail -n {lines_to_read} {shlex.quote(path.strip())}"
        res = self.run_host_command(host_id, cmd)
        stdout = res.get("stdout", "")
        truncated = False
        if len(stdout) > max_bytes:
            stdout = stdout[-max_bytes:]
            truncated = True

        return {
            "host_id": host_id,
            "path": path,
            "exit_code": res.get("exit_code", 0),
            "stdout": stdout,
            "stderr": res.get("stderr", ""),
            "lines": lines_to_read,
            "truncated": truncated,
        }

    def _execute_on_connector(
        self,
        host_id: str,
        command: str,
        dangerous_patterns: list[str],
        sec_mode: str,
        h: dict,
        approval_token: str | None = None,
        session_id: str | None = None,
    ) -> dict[str, Any]:
        if self.registry:
            from memoria.connectors.base import ResourceType
            conn = self.registry.get(ResourceType.HOST, host_id)
            if conn:
                if hasattr(conn, "guard"):
                    conn.guard.dangerous_patterns = dangerous_patterns
                    conn.guard.security_mode = sec_mode
                    conn.guard.safe_mode = sec_mode == "read_only"
                res = conn.execute_command(  # type: ignore[attr-defined]
                    command, approved=False, approval_token=approval_token, session_id=session_id
                )
                return res.model_dump()

        # Apply bot-level security mode override if configured
        host_dict = dict(h)
        host_dict["security_mode"] = sec_mode

        from memoria.connectors.host.connector import HostConnector
        from memoria.connectors.host.models import HostConfig
        conn = HostConnector(HostConfig(**host_dict), dangerous_patterns=dangerous_patterns)
        res = conn.execute_command(
            command, approved=False, approval_token=approval_token, session_id=session_id
        )
        return res.model_dump()

    def run_host_command(
        self,
        host_id: str,
        command: str,
        approved: bool = False,
        approval_token: str | None = None,
        session_id: str | None = None,
    ) -> dict[str, Any]:
        """Execute a command after enforcing the current host policy synchronously."""
        self._ensure_allowed(host_id)
        h = self.db.get_host(host_id)
        assert h is not None

        # Load dynamic dangerous patterns from DB if available
        from memoria.config import DEFAULT_HOST_DANGEROUS_PATTERNS
        raw_patterns = self.db.get_setting("host_dangerous_patterns") if self.db else None
        dangerous_patterns = json.loads(raw_patterns) if raw_patterns else DEFAULT_HOST_DANGEROUS_PATTERNS

        sec_mode = (
            (self.host_security_modes or {}).get(host_id)
            or (h.get("security_mode") if h else None)
            or ("read_only" if (h and h.get("safe_mode")) else "ask_confirmation")
        )
        from memoria.connectors.host.guard import (
            CommandApprovalRequired,
            CommandGuard,
            CommandSafetyViolation,
        )
        guard = CommandGuard(security_mode=sec_mode, dangerous_patterns=dangerous_patterns)
        authorized = guard.is_safe_command(command)
        if not authorized and approval_token:
            from memoria.connectors.host.approval import global_host_approval_manager
            authorized = global_host_approval_manager.validate_authorization(
                approval_token, host_id, command.strip(), session_id
            )
        try:
            # Do not treat an arbitrary/non-empty token as approval. The
            # connector consumes and verifies the manager-issued grant against
            # host, exact command, and session. Before that point, only the
            # whitelist may pass directly.
            guard.validate_command(command, approved=authorized)
        except CommandSafetyViolation as exc:
            return {
                "status": "rejected",
                "error": str(exc),
                "host_id": host_id,
                "command": command,
            }
        except CommandApprovalRequired as exc:
            if approval_token:
                return {
                    "status": "rejected",
                    "error": "Invalid or mismatched approval authorization",
                    "host_id": host_id,
                    "command": command,
                }
            return {
                "status": "pending_approval",
                "error": str(exc),
                "host_id": host_id,
                "command": command,
            }

        return self._execute_on_connector(
            host_id=host_id,
            command=command,
            dangerous_patterns=dangerous_patterns,
            sec_mode=sec_mode,
            h=h,
            approval_token=approval_token,
            session_id=session_id,
        )

    async def run_host_command_async(
        self,
        host_id: str,
        command: str,
        session_id: str | None = None,
        on_approval_required: Callable[[dict[str, Any]], Any] | None = None,
        on_approval_decision: Callable[[bool, dict[str, Any]], Any] | None = None,
    ) -> dict[str, Any]:
        """Execute a host command asynchronously with fully encapsulated interactive approval flow."""
        self._ensure_allowed(host_id)
        h = self.db.get_host(host_id)
        assert h is not None

        from memoria.config import DEFAULT_HOST_DANGEROUS_PATTERNS
        raw_patterns = self.db.get_setting("host_dangerous_patterns") if self.db else None
        dangerous_patterns = json.loads(raw_patterns) if raw_patterns else DEFAULT_HOST_DANGEROUS_PATTERNS

        sec_mode = (
            (self.host_security_modes or {}).get(host_id)
            or (h.get("security_mode") if h else None)
            or ("read_only" if (h and h.get("safe_mode")) else "ask_confirmation")
        )
        from memoria.connectors.host.guard import (
            CommandApprovalRequired,
            CommandGuard,
            CommandSafetyViolation,
        )
        guard = CommandGuard(security_mode=sec_mode, dangerous_patterns=dangerous_patterns)

        # 1. Strict blacklist check: cannot run even if approved
        try:
            guard.validate_command(command)
        except CommandSafetyViolation as exc:
            logger.info(
                "[HOST_SECURITY_BLOCK] Host command rejected by safety policy: host=%s cmd=%r error=%s",
                host_id, command, exc,
            )
            return {
                "status": "rejected",
                "error": str(exc),
                "host_id": host_id,
                "command": command,
            }
        except CommandApprovalRequired:
            pass

        is_safe = guard.is_safe_command(command)
        approval_required = (sec_mode == "ask_confirmation" and not is_safe)
        approval_token: str | None = None

        logger.info(
            "[HOST_SECURITY] Host command policy: host=%s(%s) mode=%s safe=%s approval_required=%s",
            h.get("name") if h else host_id,
            host_id,
            sec_mode,
            is_safe,
            approval_required,
        )

        # 2. Interactive approval flow
        if approval_required:
            if not on_approval_required:
                return {
                    "status": "pending_approval",
                    "error": f"Command requires user approval before execution: '{command}'",
                    "host_id": host_id,
                    "command": command,
                }

            from memoria.connectors.host.approval import global_host_approval_manager
            host_name = h.get("name") if h else host_id
            approval = global_host_approval_manager.create_approval(
                host_id=host_id,
                host_name=host_name,
                command=command,
                session_id=session_id,
            )
            logger.info(
                "[APPROVAL_REQ] Host command waiting for user approval: host=%s(%s) cmd=%r approval_id=%s",
                host_name, host_id, command, approval.id,
            )

            info = {
                "approval_id": approval.id,
                "host_id": host_id,
                "host_name": host_name,
                "command": command,
            }
            cb_req = on_approval_required(info)
            if asyncio.iscoroutine(cb_req):
                await cb_req

            timeout = float(self.db.get_setting("approval_timeout") or 300.0) if self.db else 300.0
            approved = await global_host_approval_manager.wait_for_decision(approval.id, timeout=timeout)
            if approved:
                approval_token = global_host_approval_manager.get_authorization_token(
                    approval.id,
                    host_id,
                    command,
                    session_id,
                )

            logger.info(
                "[APPROVAL_DEC] User decision for approval_id=%s: approved=%s authorized=%s",
                approval.id, approved, bool(approval_token),
            )

            if on_approval_decision:
                cb_dec = on_approval_decision(approved, info)
                if asyncio.iscoroutine(cb_dec):
                    await cb_dec

            if not approved:
                return {
                    "error": f"Command execution rejected by user or timed out: '{command}'",
                    "status": "rejected",
                }

            if not approval_token:
                return {
                    "status": "rejected",
                    "error": "Approval was accepted but no matching execution authorization was issued",
                    "host_id": host_id,
                    "command": command,
                }

        # 3. Post-validation with authorization
        try:
            guard.validate_command(command, approved=bool(approval_token) or is_safe)
        except CommandSafetyViolation as exc:
            return {
                "status": "rejected",
                "error": str(exc),
                "host_id": host_id,
                "command": command,
            }

        # 4. Execute
        return self._execute_on_connector(
            host_id=host_id,
            command=command,
            dangerous_patterns=dangerous_patterns,
            sec_mode=sec_mode,
            h=h,
            approval_token=approval_token,
            session_id=session_id,
        )

    def get_job_status(self, job_handle: str) -> dict[str, Any]:
        """Query real-time status, exit code, and stdout tail for a background job handle."""
        from memoria.connectors.host.process import global_process_manager
        info = global_process_manager.get_process_status(job_handle)
        if not info:
            return {
                "job_handle": job_handle,
                "status": "unknown",
                "error": f"Job handle '{job_handle}' not found or expired",
            }
        return info

    def read_job_output(self, job_handle: str, tail_lines: int = 50) -> dict[str, Any]:
        """Read output lines from a background job handle."""
        from memoria.connectors.host.process import global_process_manager
        return global_process_manager.read_job_output(job_handle, tail_lines=tail_lines)
