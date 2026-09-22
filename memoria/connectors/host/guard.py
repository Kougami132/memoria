import asyncio
import json
import logging
import re
from typing import Any, Callable, Optional, Sequence
from memoria.config import DEFAULT_HOST_DANGEROUS_PATTERNS

logger = logging.getLogger(__name__)

DANGEROUS_PATTERNS = DEFAULT_HOST_DANGEROUS_PATTERNS

# Safe commands allowed in safe_mode / read_only
SAFE_COMMAND_PREFIXES = [
    "cat", "head", "tail", "less", "more", "grep", "egrep", "fgrep", "awk", "sed",
    "ls", "dir", "pwd", "cd", "find", "stat", "file", "wc", "diff",
    "ps", "top", "htop", "free", "df", "du", "uptime", "uname", "whoami", "id", "env",
    "netstat", "ss", "ip", "ifconfig", "ping", "traceroute", "curl", "wget",
    "systemctl status", "service", "journalctl", "dmesg", "docker ps", "docker logs", "docker stats"
]

MAX_OUTPUT_CHARS = 8000
DEFAULT_TIMEOUT_SECONDS = 15


class CommandSafetyViolation(Exception):
    pass


class CommandApprovalRequired(Exception):
    def __init__(self, message: str, command: str = ""):
        super().__init__(message)
        self.command = command


class CommandGuard:
    def __init__(
        self,
        safe_mode: bool = False,
        security_mode: Optional[str] = None,
        dangerous_patterns: Optional[Sequence[str]] = None,
        max_output_chars: int = MAX_OUTPUT_CHARS,
    ):
        if security_mode:
            self.security_mode = security_mode
        else:
            self.security_mode = "read_only" if safe_mode else "ask_confirmation"
        self.safe_mode = (self.security_mode == "read_only")
        self.dangerous_patterns = dangerous_patterns if dangerous_patterns is not None else DANGEROUS_PATTERNS
        self.max_output_chars = max_output_chars

    def is_safe_command(self, command: str) -> bool:
        cmd_stripped = command.strip()
        if not cmd_stripped:
            return True
        subcmds = [c.strip() for c in re.split(r"[|;&]", cmd_stripped)]
        for sc in subcmds:
            if not sc:
                continue
            is_safe = any(
                sc == prefix or sc.startswith(prefix + " ") or sc.startswith(prefix + "\t")
                for prefix in SAFE_COMMAND_PREFIXES
            )
            if not is_safe:
                return False
        return True

    def check(self, command: str, approved: bool = False) -> None:
        """Alias for validate_command."""
        return self.validate_command(command, approved=approved)

    def validate_command(self, command: str, approved: bool = False) -> None:
        cmd_stripped = command.strip()
        if not cmd_stripped:
            return

        # 1. Strict blacklist check: cannot run even if approved
        for pattern in self.dangerous_patterns:
            if pattern and re.search(pattern, cmd_stripped, re.IGNORECASE):
                raise CommandSafetyViolation(
                    f"Command execution blocked: potentially dangerous pattern detected in '{command}'"
                )

        # 2. Mode checks
        if self.security_mode == "read_only":
            if not self.is_safe_command(cmd_stripped):
                raise CommandSafetyViolation(
                    f"Command execution blocked in Safe Mode: '{command}' is not in the safe command whitelist"
                )
        elif self.security_mode == "ask_confirmation":
            if not self.is_safe_command(cmd_stripped) and not approved:
                raise CommandApprovalRequired(
                    f"Command '{command}' requires user approval before execution",
                    command=command,
                )
        elif self.security_mode == "unrestricted":
            # Runs all commands except dangerous blacklist
            pass

    def truncate_output(self, text: Optional[str]) -> str:
        if not text:
            return ""
        if len(text) <= self.max_output_chars:
            return text
        truncated = text[: self.max_output_chars]
        omitted = len(text) - self.max_output_chars
        return f"{truncated}\n\n... [Output truncated: {omitted} characters omitted] ..."


# Alias for backward compatibility and spec alignment
HostCommandGuard = CommandGuard


def resolve_host_security_mode(host_info: Optional[dict], host_security_modes: Optional[dict], host_id: str) -> str:
    """Resolve effective security mode considering bot-level overrides and safe mode."""
    if host_security_modes and host_id in host_security_modes:
        return str(host_security_modes[host_id])
    if host_info:
        if host_info.get("security_mode"):
            return str(host_info["security_mode"])
        if host_info.get("safe_mode"):
            return "read_only"
    return "ask_confirmation"


def execute_guarded_host_command_sync(
    tools: Any,
    host_id: str,
    command: str,
    session_id: Optional[str] = None,
    db: Any = None,
) -> dict[str, Any]:
    """Synchronous guarded execution entry point. Fails closed on commands requiring approval."""
    host_tools = getattr(tools, "host", None)
    effective_db = db or getattr(host_tools, "db", None) or getattr(tools, "db", None)
    h = effective_db.get_host(host_id) if effective_db else None
    host_sec_modes = getattr(host_tools, "host_security_modes", None)
    sec_mode = resolve_host_security_mode(h, host_sec_modes, host_id)

    raw_patterns = effective_db.get_setting("host_dangerous_patterns") if effective_db else None
    dangerous_patterns = json.loads(raw_patterns) if raw_patterns else DEFAULT_HOST_DANGEROUS_PATTERNS
    guard = CommandGuard(security_mode=sec_mode, dangerous_patterns=dangerous_patterns)

    try:
        guard.validate_command(command)
    except CommandSafetyViolation as exc:
        logger.info(
            "[HOST_SECURITY_BLOCK] Synchronous host command rejected by safety policy: host=%s cmd=%r error=%s",
            host_id, command, exc,
        )
        return {
            "status": "rejected",
            "error": str(exc),
            "host_id": host_id,
            "command": command,
        }
    except CommandApprovalRequired:
        logger.info(
            "[APPROVAL_BLOCKED_SYNC] Synchronous host command requires channel approval: host=%s cmd=%r",
            host_id, command,
        )
        return {
            "status": "pending_approval",
            "error": f"Command requires user approval before execution: '{command}'",
            "host_id": host_id,
            "command": command,
        }

    return tools.run_host_command(host_id, command, approved=False)


async def execute_guarded_host_command_async(
    tools: Any,
    host_id: str,
    command: str,
    session_id: Optional[str] = None,
    on_approval_required: Optional[Callable[[dict[str, Any]], Any]] = None,
    on_approval_decision: Optional[Callable[[bool, dict[str, Any]], Any]] = None,
    db: Any = None,
) -> dict[str, Any]:
    """Asynchronous guarded execution entry point with fully encapsulated approval lifecycle."""
    host_tools = getattr(tools, "host", None)
    effective_db = db or getattr(host_tools, "db", None) or getattr(tools, "db", None)
    h = effective_db.get_host(host_id) if effective_db else None
    host_sec_modes = getattr(host_tools, "host_security_modes", None)
    sec_mode = resolve_host_security_mode(h, host_sec_modes, host_id)

    raw_patterns = effective_db.get_setting("host_dangerous_patterns") if effective_db else None
    dangerous_patterns = json.loads(raw_patterns) if raw_patterns else DEFAULT_HOST_DANGEROUS_PATTERNS
    guard = CommandGuard(security_mode=sec_mode, dangerous_patterns=dangerous_patterns)

    # 1. Strict blacklist check
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
    approval_token: Optional[str] = None

    logger.info(
        "[HOST_SECURITY] Host command policy: host=%s(%s) mode=%s safe=%s approval_required=%s",
        h.get("name") if h else host_id,
        host_id,
        sec_mode,
        is_safe,
        approval_required,
    )

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
        if on_approval_required:
            cb_req = on_approval_required(info)
            if asyncio.iscoroutine(cb_req):
                await cb_req

        timeout = float(effective_db.get_setting("approval_timeout") or 300.0) if effective_db else 300.0
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

    # 4. Execute on tools
    return tools.run_host_command(
        host_id,
        command,
        approved=False,
        approval_token=approval_token,
        session_id=session_id,
    )
