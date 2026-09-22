import logging
import re
import threading
import time
import uuid
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class JobHandle(BaseModel):
    job_id: str
    host_id: str
    command: str
    status: str = "running"  # running, completed, failed, terminated
    pid: Optional[int] = None
    started_at: float = Field(default_factory=time.time)
    finished_at: Optional[float] = None
    exit_code: Optional[int] = None
    log_file: Optional[str] = None
    output_lines: List[str] = Field(default_factory=list)
    error: Optional[str] = None


class ProcessManager:
    """
    Manages long-running asynchronous background jobs for HostAgent.
    Tracks job handles, execution logs, and background process status.
    """

    def __init__(self) -> None:
        self._jobs: Dict[str, JobHandle] = {}
        self._lock = threading.RLock()

    @staticmethod
    def is_background_command(command: str) -> bool:
        """
        Detects if a command is explicitly or implicitly intended for long-running / background execution.
        Matches trailing '&', nohup, tmux, screen, daemon, etc.
        """
        if not command:
            return False
        cmd = command.strip()
        patterns = [
            r'(&\s*$)',
            r'(?:^|[|;&\s])nohup\s+',
            r'(?:^|[|;&\s])tmux\s+(?:new|start)',
            r'(?:^|[|;&\s])screen\s+',
            r'(?:^|[|;&\s])daemon\s+',
        ]
        return any(re.search(p, cmd, re.IGNORECASE) for p in patterns)

    def register_job(
        self,
        host_id: str,
        command: str,
        pid: Optional[int] = None,
        log_file: Optional[str] = None,
        job_id: Optional[str] = None,
    ) -> dict[str, Any]:
        with self._lock:
            jid = job_id or f"job_{uuid.uuid4().hex[:12]}"
            logfile = log_file or f"/tmp/memoria_{jid}.log"
            handle = JobHandle(
                job_id=jid,
                host_id=host_id,
                command=command,
                status="running",
                pid=pid,
                log_file=logfile,
            )
            self._jobs[jid] = handle
            return self._handle_to_dict(handle)

    # Alias for backward compatibility
    register_process = register_job

    def append_output(self, job_id: str, text: str) -> None:
        with self._lock:
            handle = self._jobs.get(job_id)
            if not handle or not text:
                return
            new_lines = text.splitlines()
            handle.output_lines.extend(new_lines)
            # Keep at most 2000 lines in buffer
            if len(handle.output_lines) > 2000:
                handle.output_lines = handle.output_lines[-2000:]

    def update_job_status(
        self,
        job_id: str,
        status: str,
        exit_code: Optional[int] = None,
        output: Optional[str] = None,
        error: Optional[str] = None,
    ) -> Optional[dict[str, Any]]:
        with self._lock:
            handle = self._jobs.get(job_id)
            if not handle:
                return None
            handle.status = status
            if exit_code is not None:
                handle.exit_code = exit_code
            if error is not None:
                handle.error = error
            if output:
                self.append_output(job_id, output)
            if status in ("completed", "failed", "terminated"):
                handle.finished_at = time.time()
            return self._handle_to_dict(handle)

    def get_job_status(self, job_id: str) -> dict[str, Any]:
        with self._lock:
            handle = self._jobs.get(job_id)
            if not handle:
                return {
                    "job_id": job_id,
                    "job_handle": job_id,
                    "status": "unknown",
                    "error": f"Job handle '{job_id}' not found or expired",
                }
            return self._handle_to_dict(handle)

    # Alias
    get_process_status = get_job_status

    def read_job_output(self, job_id: str, tail_lines: int = 50) -> dict[str, Any]:
        with self._lock:
            handle = self._jobs.get(job_id)
            if not handle:
                return {
                    "job_id": job_id,
                    "status": "unknown",
                    "output": "",
                    "error": f"Job handle '{job_id}' not found",
                }
            lines_to_return = handle.output_lines[-max(1, tail_lines):]
            return {
                "job_id": job_id,
                "host_id": handle.host_id,
                "status": handle.status,
                "exit_code": handle.exit_code,
                "total_lines": len(handle.output_lines),
                "lines": lines_to_return,
                "output": "\n".join(lines_to_return),
            }

    def terminate_job(self, job_id: str) -> dict[str, Any]:
        with self._lock:
            handle = self._jobs.get(job_id)
            if not handle:
                return {"job_id": job_id, "status": "unknown"}
            handle.status = "terminated"
            handle.finished_at = time.time()
            return self._handle_to_dict(handle)

    def list_jobs(self, host_id: Optional[str] = None) -> List[dict[str, Any]]:
        with self._lock:
            if host_id:
                return [self._handle_to_dict(j) for j in self._jobs.values() if j.host_id == host_id]
            return [self._handle_to_dict(j) for j in self._jobs.values()]

    def _handle_to_dict(self, handle: JobHandle) -> dict[str, Any]:
        tail = "\n".join(handle.output_lines[-20:]) if handle.output_lines else ""
        return {
            "job_id": handle.job_id,
            "job_handle": handle.job_id,
            "host_id": handle.host_id,
            "command": handle.command,
            "status": handle.status,
            "pid": handle.pid,
            "started_at": handle.started_at,
            "finished_at": handle.finished_at,
            "exit_code": handle.exit_code,
            "log_file": handle.log_file,
            "tail_output": tail,
            "error": handle.error,
        }


global_process_manager = ProcessManager()
