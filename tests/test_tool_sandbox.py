import asyncio
import pytest
from unittest.mock import MagicMock

from memoria.agents.sandbox import (
    get_tool_timeout,
    truncate_tool_output,
    execute_tool_with_sandbox,
    MAX_TOOL_OUTPUT_CHARS,
)


def test_tiered_hard_timeouts_configuration():
    # Local & Knowledge: 5s
    assert get_tool_timeout("search_knowledge_base") == 5.0
    assert get_tool_timeout("get_host_info") == 5.0
    assert get_tool_timeout("list_hosts") == 5.0
    assert get_tool_timeout("get_job_status") == 5.0

    # Web search: 15s
    assert get_tool_timeout("web_search") == 15.0
    assert get_tool_timeout("delegate_to_web_agent") == 15.0

    # Host operations: 30s
    assert get_tool_timeout("run_host_command") == 30.0
    assert get_tool_timeout("read_host_log_tail") == 30.0
    assert get_tool_timeout("delegate_to_host_agent") == 30.0


def test_defensive_output_truncation_8kb():
    # String truncation
    huge_str = "x" * 12000
    truncated_str = truncate_tool_output(huge_str)
    assert len(truncated_str) < 12000
    assert "Output truncated" in truncated_str
    assert "Filter output using grep, head, or tail" in truncated_str

    # Dict stdout truncation
    huge_dict = {
        "exit_code": 0,
        "stdout": "LOG LINE\n" * 1000,  # > 8KB
        "stderr": "",
    }
    truncated_dict = truncate_tool_output(huge_dict)
    assert len(truncated_dict["stdout"]) < len(huge_dict["stdout"])
    assert "Output truncated" in truncated_dict["stdout"]
    assert truncated_dict.get("truncated") is True

    # Short output should not be touched
    short_dict = {"stdout": "healthy status", "exit_code": 0}
    assert truncate_tool_output(short_dict) == short_dict


@pytest.mark.asyncio
async def test_tool_timeout_cuts_off_hung_execution():
    async def hung_operation():
        await asyncio.sleep(1.0)
        return "finished"

    # With a 0.05s timeout, hung_operation must be aborted cleanly
    res = await execute_tool_with_sandbox("test_hung_tool", hung_operation, timeout=0.05)
    assert res["status"] == "timeout"
    assert "timed out after" in res["error"]
    assert res["tool"] == "test_hung_tool"


@pytest.mark.asyncio
async def test_global_tool_exception_containment():
    def throwing_tool():
        raise ConnectionResetError("Remote server closed socket violently")

    # The exception must be gracefully converted into a tool error dict, not re-raised
    res = await execute_tool_with_sandbox("network_tool", throwing_tool)
    assert res["status"] == "error"
    assert "Remote server closed socket violently" in res["error"]
    assert res["tool"] == "network_tool"


@pytest.mark.asyncio
async def test_tool_sandbox_preserves_successful_results():
    async def good_tool():
        return {"data": "all systems operational", "count": 42}

    res = await execute_tool_with_sandbox("good_tool", good_tool)
    assert res["data"] == "all systems operational"
    assert res["count"] == 42
