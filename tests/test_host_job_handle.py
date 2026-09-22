import pytest
from unittest.mock import MagicMock
from memoria.connectors.host.guard import CommandGuard, CommandSafetyViolation, HostCommandGuard
from memoria.connectors.host.process import ProcessManager
from memoria.connectors.host.connector import HostConnector
from memoria.connectors.host.models import HostConfig, CommandResult
from memoria.connectors.host.tools import AgentHostTools
from memoria.config import DEFAULT_HOST_DANGEROUS_PATTERNS


def test_command_guard_blocks_self_destruct_patterns():
    guard = HostCommandGuard(safe_mode=False, dangerous_patterns=DEFAULT_HOST_DANGEROUS_PATTERNS)

    blocked_commands = [
        "rm -rf /",
        "rm -rf /*",
        "rm -rf ..",
        "mkfs.ext4 /dev/sda1",
        "fdisk /dev/sdb",
        "dd if=/dev/zero of=/dev/sda bs=1M",
        "reboot",
        "shutdown -h now",
        "echo 1 > /dev/sda",
        "chmod -R 777 /",
        "chown -R root:root /",
        "passwd root",
        ":(){ :|:& };:",
    ]

    for cmd in blocked_commands:
        with pytest.raises(CommandSafetyViolation) as exc_info:
            guard.check(cmd, approved=False)
        assert "dangerous pattern" in str(exc_info.value).lower() or "blocked" in str(exc_info.value).lower()

        # Even with approved=True, dangerous patterns must NEVER execute
        with pytest.raises(CommandSafetyViolation):
            guard.check(cmd, approved=True)


def test_process_manager_detects_background():
    assert ProcessManager.is_background_command("nohup python server.py &") is True
    assert ProcessManager.is_background_command("tmux new-session -d 'top'") is True
    assert ProcessManager.is_background_command("screen -dmS worker ./job.sh") is True
    assert ProcessManager.is_background_command("ls -la &") is True
    assert ProcessManager.is_background_command("ls -la") is False
    assert ProcessManager.is_background_command("cat file.txt") is False


def test_process_manager_lifecycle():
    pm = ProcessManager()
    job = pm.register_job("host-1", "nohup sleep 10 &", pid=12345)
    assert job["job_handle"].startswith("job_")
    assert job["host_id"] == "host-1"
    assert job["pid"] == 12345
    assert job["status"] == "running"

    pm.append_output(job["job_handle"], "Line 1 output\nLine 2 output")
    output = pm.read_job_output(job["job_handle"], tail_lines=10)
    assert output["total_lines"] == 2
    assert "Line 1 output" in output["output"]

    pm.update_job_status(job["job_handle"], "completed", exit_code=0)
    status = pm.get_job_status(job["job_handle"])
    assert status["status"] == "completed"
    assert status["exit_code"] == 0

    assert pm.get_job_status("nonexistent")["status"] == "unknown"


def test_host_connector_background_returns_job_handle():
    cfg = HostConfig(
        id="host-1",
        name="test-host",
        host="127.0.0.1",
        port=22,
        username="root",
        auth_type="password",
        credential="",
        security_mode="unrestricted",
    )
    conn = HostConnector(cfg)

    result = conn.execute_command("nohup python app.py &", approved=True)
    assert result.job_handle is not None
    assert result.job_handle["job_handle"].startswith("job_")
    assert "Job Handle" in result.stdout
    assert result.exit_code == 0


def test_agent_host_tools_job_queries():
    mock_db = MagicMock()
    mock_collector = MagicMock()
    tools = AgentHostTools(
        db=mock_db,
        allowed_host_ids=["host-1"],
        collector=mock_collector,
    )

    from memoria.connectors.host.process import global_process_manager
    job = global_process_manager.register_job("host-1", "nohup ping 127.0.0.1 &", pid=5555)
    global_process_manager.append_output(job["job_id"], "ping response packet\n")

    status = tools.get_job_status(job["job_id"])
    assert status["status"] == "running"
    assert status["pid"] == 5555

    logs = tools.read_job_output(job["job_id"], tail_lines=5)
    assert "ping response packet" in logs["output"]


@pytest.mark.asyncio
async def test_orchestrator_turn_host_job_tools():
    from memoria.agents.engine import _execute_agent_tool_async
    from memoria.connectors.host.process import global_process_manager

    job = global_process_manager.register_job("host-2", "top -b -n 1 &", pid=7777)
    global_process_manager.append_output(job["job_id"], "top output data\n")

    class FakeTools:
        def get_job_status(self, job_handle):
            return global_process_manager.get_job_status(job_handle)

        def read_job_output(self, job_handle, tail_lines=50):
            return global_process_manager.read_job_output(job_handle, tail_lines=tail_lines)

    tools = FakeTools()

    status_res = await _execute_agent_tool_async(
        "get_job_status",
        {"job_handle": job["job_id"]},
        tools,
    )
    assert status_res["status"] == "running"
    assert status_res["pid"] == 7777

    out_res = await _execute_agent_tool_async(
        "read_job_output",
        {"job_handle": job["job_id"], "tail_lines": 5},
        tools,
    )
    assert "top output data" in out_res["output"]
