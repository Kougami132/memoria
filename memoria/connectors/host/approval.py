import asyncio
import secrets
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Optional, Dict, Any


@dataclass
class HostCommandApproval:
    id: str
    host_id: str
    host_name: str
    command: str
    session_id: Optional[str] = None
    created_at: float = field(default_factory=time.time)
    status: str = "pending"  # "pending", "approved", "rejected", "timeout"
    event: asyncio.Event = field(default_factory=asyncio.Event)
    loop: Optional[asyncio.AbstractEventLoop] = None
    authorization_token: str = field(default_factory=lambda: secrets.token_urlsafe(32), repr=False)


class HostApprovalManager:
    """Manages pending command approvals for interactive host command execution."""

    def __init__(self, default_timeout: float = 300.0) -> None:
        self.default_timeout = default_timeout
        self._approvals: Dict[str, HostCommandApproval] = {}
        self._consumed_tokens: set[str] = set()
        self._lock = threading.RLock()

    def create_approval(
        self,
        host_id: str,
        host_name: str,
        command: str,
        session_id: Optional[str] = None,
    ) -> HostCommandApproval:
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None
        approval_id = f"appr_{uuid.uuid4().hex[:12]}"
        approval = HostCommandApproval(
            id=approval_id,
            host_id=host_id,
            host_name=host_name,
            command=command,
            session_id=session_id,
            loop=loop,
        )
        with self._lock:
            self._approvals[approval_id] = approval
        return approval

    def get_approval(self, approval_id: str) -> Optional[HostCommandApproval]:
        with self._lock:
            return self._approvals.get(approval_id)

    def respond(self, approval_id: str, approved: bool) -> Optional[HostCommandApproval]:
        with self._lock:
            approval = self._approvals.get(approval_id)
            if not approval or approval.status != "pending":
                return approval
            approval.status = "approved" if approved else "rejected"
        if approval.loop and not approval.loop.is_closed():
            approval.loop.call_soon_threadsafe(approval.event.set)
        else:
            approval.event.set()
        return approval

    def get_authorization_token(
        self,
        approval_id: str,
        host_id: str,
        command: str,
        session_id: Optional[str] = None,
    ) -> Optional[str]:
        """Return the private execution grant after an approval decision."""
        with self._lock:
            approval = self._approvals.get(approval_id)
            if not approval or approval.status != "approved":
                return None
            if (
                approval.host_id != host_id
                or approval.command != command
                or approval.session_id != session_id
            ):
                return None
            return approval.authorization_token

    def consume_authorization(
        self,
        token: str,
        host_id: str,
        command: str,
        session_id: Optional[str] = None,
    ) -> bool:
        """Atomically consume a grant and verify its exact command binding."""
        if not token:
            return False
        with self._lock:
            for approval in self._approvals.values():
                if approval.authorization_token != token:
                    continue
                if token in self._consumed_tokens or approval.status != "approved":
                    return False
                if (
                    approval.host_id != host_id
                    or approval.command != command
                    or approval.session_id != session_id
                ):
                    return False
                self._consumed_tokens.add(token)
                return True
        return False

    def validate_authorization(
        self,
        token: str,
        host_id: str,
        command: str,
        session_id: Optional[str] = None,
    ) -> bool:
        """Check a grant without consuming it.

        Tool layers use this as a preflight check. The connector remains the
        single execution boundary and consumes the grant atomically.
        """
        if not token:
            return False
        with self._lock:
            for approval in self._approvals.values():
                if approval.authorization_token != token:
                    continue
                return (
                    token not in self._consumed_tokens
                    and approval.status == "approved"
                    and approval.host_id == host_id
                    and approval.command == command
                    and approval.session_id == session_id
                )
        return False

    async def wait_for_decision(self, approval_id: str, timeout: Optional[float] = None) -> bool:
        with self._lock:
            approval = self._approvals.get(approval_id)
        if not approval:
            return False
        tout = timeout or self.default_timeout
        try:
            await asyncio.wait_for(approval.event.wait(), timeout=tout)
            with self._lock:
                return approval.status == "approved"
        except asyncio.TimeoutError:
            # Do not overwrite an approval that raced with the timeout.
            with self._lock:
                if approval.status == "pending":
                    approval.status = "timeout"
            return False


# Global approval manager singleton
global_host_approval_manager = HostApprovalManager()
