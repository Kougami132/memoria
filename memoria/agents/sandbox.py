import asyncio
import copy
import json
import logging
from typing import Any, Callable, Coroutine, Dict, Optional

logger = logging.getLogger(__name__)

MAX_TOOL_OUTPUT_CHARS = 8192

TOOL_TIMEOUTS: Dict[str, float] = {
    # Local & Knowledge Base operations: 5s
    "list_knowledge_bases": 5.0,
    "search_knowledge_base": 5.0,
    "read_knowledge_document": 5.0,
    "list_hosts": 5.0,
    "get_host_info": 5.0,
    "get_job_status": 5.0,
    "read_job_output": 5.0,
    "delegate_to_knowledge_agent": 5.0,

    # Web search operations: 15s
    "web_search": 15.0,
    "delegate_to_web_agent": 15.0,

    # Host operations / execution: 30s
    "run_host_command": 30.0,
    "read_host_log_tail": 30.0,
    "delegate_to_host_agent": 30.0,
}


def get_tool_timeout(tool_name: str) -> float:
    """Return the tiered hard timeout for the specified tool name."""
    if tool_name in TOOL_TIMEOUTS:
        return TOOL_TIMEOUTS[tool_name]
    if "web" in tool_name or "search" in tool_name:
        return 15.0
    if "host" in tool_name or "cmd" in tool_name or "command" in tool_name:
        return 30.0
    return 5.0


def truncate_tool_output(output: Any, max_chars: int = MAX_TOOL_OUTPUT_CHARS) -> Any:
    """
    Defensively truncate tool outputs exceeding max_chars (8KB),
    appending guidance for the LLM.
    """
    if output is None:
        return ""

    if isinstance(output, str):
        if len(output) <= max_chars:
            return output
        omitted = len(output) - max_chars
        return (
            output[:max_chars]
            + f"\n\n... [Output truncated: {omitted} characters omitted. Filter output using grep, head, or tail.] ..."
        )

    if isinstance(output, dict):
        truncated_dict = copy.deepcopy(output)
        for key in ["stdout", "output", "content", "text", "stderr"]:
            val = truncated_dict.get(key)
            if isinstance(val, str) and len(val) > max_chars:
                omitted = len(val) - max_chars
                truncated_dict[key] = (
                    val[:max_chars]
                    + f"\n\n... [Output truncated: {omitted} characters omitted. Filter output using grep, head, or tail.] ..."
                )
                truncated_dict["truncated"] = True
        return truncated_dict

    if isinstance(output, list):
        # Truncate string items if necessary
        truncated_list = []
        for item in output:
            if isinstance(item, (str, dict)):
                truncated_list.append(truncate_tool_output(item, max_chars=max_chars))
            else:
                truncated_list.append(item)
        return truncated_list

    return output


async def execute_tool_with_sandbox(
    tool_name: str,
    coroutine_or_fn: Callable[[], Any],
    timeout: Optional[float] = None,
    max_output_chars: int = MAX_TOOL_OUTPUT_CHARS,
) -> Any:
    """
    Execute a tool within a defensive sandbox:
      1. Enforces tiered hard timeouts (5s / 15s / 30s)
      2. Catches all exceptions and degrades gracefully into a structured Tool Error
      3. Enforces 8KB defensive output truncation
    """
    if timeout is not None:
        tout = timeout
    elif tool_name in ("run_host_command", "delegate_to_host_agent"):
        tout = 305.0
    else:
        tout = get_tool_timeout(tool_name)

    try:
        if asyncio.iscoroutinefunction(coroutine_or_fn) or asyncio.iscoroutine(coroutine_or_fn):
            task = coroutine_or_fn() if callable(coroutine_or_fn) else coroutine_or_fn
            res = await asyncio.wait_for(task, timeout=tout)
        else:
            # Synchronous callable run in thread
            res = await asyncio.wait_for(
                asyncio.to_thread(coroutine_or_fn),
                timeout=tout,
            )
        return truncate_tool_output(res, max_chars=max_output_chars)
    except asyncio.TimeoutError:
        err_msg = f"Tool '{tool_name}' execution timed out after {tout}s"
        logger.warning(err_msg)
        return {
            "status": "timeout",
            "error": err_msg,
            "tool": tool_name,
        }
    except Exception as e:
        err_msg = f"Tool '{tool_name}' execution error: {str(e)}"
        logger.warning(err_msg)
        return {
            "status": "error",
            "error": err_msg,
            "tool": tool_name,
        }
