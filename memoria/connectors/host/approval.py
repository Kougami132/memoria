import asyncio
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


class HostApprovalManager:
    """Manages pending command approvals for interactive host command execution."""

    def __init__(self, default_timeout: float = 300.0) -> None:
        self.default_timeout = default_timeout
        self._approvals: Dict[str, HostCommandApproval] = {}

    def create_approval(
        self,
        host_id: str,
        host_name: str,
        command: str,
        session_id: Optional[str] = None,
    ) -> HostCommandApproval:
        approval_id = f"appr_{uuid.uuid4().hex[:12]}"
        approval = HostCommandApproval(
            id=approval_id,
            host_id=host_id,
            host_name=host_name,
            command=command,
            session_id=session_id,
        )
        self._approvals[approval_id] = approval
        return approval

    def get_approval(self, approval_id: str) -> Optional[HostCommandApproval]:
        return self._approvals.get(approval_id)

    def respond(self, approval_id: str, approved: bool) -> Optional[HostCommandApproval]:
        approval = self._approvals.get(approval_id)
        if not approval or approval.status != "pending":
            return approval
        approval.status = "approved" if approved else "rejected"
        approval.event.set()
        return approval

    async def wait_for_decision(self, approval_id: str, timeout: Optional[float] = None) -> bool:
        approval = self._approvals.get(approval_id)
        if not approval:
            return False
        tout = timeout or self.default_timeout
        try:
            await asyncio.wait_for(approval.event.wait(), timeout=tout)
            return approval.status == "approved"
        except asyncio.TimeoutError:
            approval.status = "timeout"
            return False


# Global approval manager singleton
global_host_approval_manager = HostApprovalManager()
