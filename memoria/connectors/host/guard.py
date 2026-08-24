import re
from typing import Optional, Sequence
from memoria.config import DEFAULT_HOST_DANGEROUS_PATTERNS

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
