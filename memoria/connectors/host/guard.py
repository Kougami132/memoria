import re
from typing import Optional


DANGEROUS_PATTERNS = [
    r"\brm\s+-(?:[a-zA-Z]*r[a-zA-Z]*f|[a-zA-Z]*f[a-zA-Z]*r)\s+(?:/|/\*|\.\.|\./\.\.)(?:\s|$)",
    r"\brm\s+-[a-zA-Z]*\s+(?:/|/\*)(?:\s|$)",
    r"\bmkfs(?:\.\w+)?\b",
    r"\bfdisk\b",
    r"\bdd\s+if=.*of=/dev/[a-z0-9]+",
    r"\b(?:reboot|shutdown|poweroff|init\s+0|init\s+6)\b",
    r">\s*/dev/(?:sd[a-z]|nvme[0-9]|hd[a-z])",
]

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


class CommandGuard:
    def __init__(self, safe_mode: bool = False, max_output_chars: int = MAX_OUTPUT_CHARS):
        self.safe_mode = safe_mode
        self.max_output_chars = max_output_chars

    def validate_command(self, command: str) -> None:
        cmd_stripped = command.strip()
        if not cmd_stripped:
            return

        # Check blacklist
        for pattern in DANGEROUS_PATTERNS:
            if re.search(pattern, cmd_stripped, re.IGNORECASE):
                raise CommandSafetyViolation(
                    f"Command execution blocked: potentially dangerous pattern detected in '{command}'"
                )

        # Check safe mode
        if self.safe_mode:
            # Check if command or pipeline components match safe prefix
            subcmds = [c.strip() for c in re.split(r"[|;&]", cmd_stripped)]
            for sc in subcmds:
                if not sc:
                    continue
                is_safe = any(
                    sc.startswith(prefix) for prefix in SAFE_COMMAND_PREFIXES
                )
                if not is_safe:
                    raise CommandSafetyViolation(
                        f"Command execution blocked in Safe Mode: '{sc}' is not in the safe command whitelist"
                    )

    def truncate_output(self, text: Optional[str]) -> str:
        if not text:
            return ""
        if len(text) <= self.max_output_chars:
            return text
        truncated = text[: self.max_output_chars]
        omitted = len(text) - self.max_output_chars
        return f"{truncated}\n\n... [Output truncated: {omitted} characters omitted] ..."
