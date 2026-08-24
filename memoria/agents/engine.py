from __future__ import annotations

import asyncio
import ast
import copy
import json
import logging
import threading
from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING, Any, Protocol

from memoria.agents.state import SourceCollector
from memoria.agents.tools import AgentTools, TOOL_METADATA
from memoria.storage.db import DB

if TYPE_CHECKING:
    from memoria.core.pipeline import Pipeline

logger = logging.getLogger(__name__)


class AgenticSdkUnavailable(RuntimeError):
    """Raised when the optional OpenAI Agents SDK is unavailable or unsupported."""


@dataclass
class AgenticRunResult:
    answer: str
    sources: list[dict]
    used_kbs: list[str]


@dataclass
class AgentRunnerOutput:
    answer: str
    trace: dict | None = None


class AgentRunner(Protocol):
    def run(
        self,
        message: str,
        instructions: str,
        tools: Any,
        model_name: str,
        session_id: str | None = None,
        tools_schema: list[dict] | None = None,
    ) -> AgentRunnerOutput | str:
        ...


def _parse_timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _duration_ms(started_at: str | None, ended_at: str | None) -> int | None:
    start = _parse_timestamp(started_at)
    end = _parse_timestamp(ended_at)
    if start is None or end is None:
        return None
    return max(0, round((end - start).total_seconds() * 1000))


def _span_name(span_data: dict[str, Any]) -> str:
    span_type = str(span_data.get("type") or "span")
    if span_data.get("name"):
        return str(span_data["name"])
    if span_type == "generation" and span_data.get("model"):
        return str(span_data["model"])
    if span_type == "handoff":
        from_agent = span_data.get("from_agent") or "agent"
        to_agent = span_data.get("to_agent") or "agent"
        return f"{from_agent} → {to_agent}"
    return span_type


class _LocalTraceProcessor:
    """Process-wide local trace collector for the optional OpenAI Agents SDK.

    The Agents SDK registers tracing processors globally. This collector replaces the default
    OpenAI backend exporter once, stores all traces keyed by trace id, and lets each runner pop
    the trace it created after the SDK run finishes.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._traces: dict[str, dict[str, Any]] = {}

    def on_trace_start(self, trace: Any) -> None:
        exported = trace.export() or {}
        trace_id = str(exported.get("id") or trace.trace_id)
        with self._lock:
            current = self._traces.setdefault(trace_id, {"trace": exported, "spans": []})
            current["trace"] = exported

    def on_trace_end(self, trace: Any) -> None:
        exported = trace.export() or {}
        trace_id = str(exported.get("id") or trace.trace_id)
        with self._lock:
            current = self._traces.setdefault(trace_id, {"trace": exported, "spans": []})
            current["trace"] = exported

    def on_span_start(self, span: Any) -> None:
        # We only persist ended spans so duration and error fields are complete.
        return None

    def on_span_end(self, span: Any) -> None:
        exported = span.export()
        if not exported:
            return
        normalized = _normalize_span(exported)
        trace_id = str(normalized.get("trace_id") or "")
        if not trace_id:
            return
        with self._lock:
            current = self._traces.setdefault(trace_id, {"trace": {"id": trace_id}, "spans": []})
            current["spans"].append(normalized)

    def shutdown(self) -> None:
        return None

    def force_flush(self) -> None:
        return None

    def pop_trace(self, trace_id: str) -> dict | None:
        with self._lock:
            payload = self._traces.pop(trace_id, None)
        if payload is None:
            return None
        return _normalize_trace_payload(payload)


_LOCAL_TRACE_PROCESSOR = _LocalTraceProcessor()
_TRACE_PROCESSOR_LOCK = threading.Lock()
_TRACE_PROCESSOR_CONFIGURED = False



def _safe_parse_json_or_literal(val: Any) -> Any:
    if val is None:
        return None
    if isinstance(val, (dict, list)):
        return val
    if isinstance(val, str):
        s = val.strip()
        if not s:
            return None
        try:
            return json.loads(s)
        except Exception:
            pass
        try:
            return ast.literal_eval(s)
        except Exception:
            pass
    return val


def _extract_reasoning_content(span_data: dict[str, Any]) -> str | None:
    """Extract reasoning / thought text if present from generation output."""
    output = span_data.get("output")
    if isinstance(output, list):
        for item in output:
            if isinstance(item, dict):
                if item.get("reasoning_content"):
                    return str(item["reasoning_content"])
                if item.get("thought"):
                    return str(item["thought"])
                if item.get("reasoning"):
                    return str(item["reasoning"])
    elif isinstance(output, dict):
        if output.get("reasoning_content"):
            return str(output["reasoning_content"])
        if output.get("thought"):
            return str(output["thought"])
        if output.get("reasoning"):
            return str(output["reasoning"])
    return None

def _normalize_span(exported: dict[str, Any]) -> dict:
    span_data = exported.get("span_data") or {}
    # Deep parse input and output if they are serialized strings
    cleaned_data = dict(span_data)
    if "input" in cleaned_data:
        cleaned_data["input"] = _safe_parse_json_or_literal(cleaned_data["input"])
    if "output" in cleaned_data:
        cleaned_data["output"] = _safe_parse_json_or_literal(cleaned_data["output"])

    started_at = exported.get("started_at")
    ended_at = exported.get("ended_at")
    reasoning = _extract_reasoning_content(span_data)
    usage = span_data.get("usage") or exported.get("usage")
    if usage is None and isinstance(cleaned_data.get("output"), dict):
        usage = cleaned_data["output"].get("usage")
    return {
        "id": exported.get("id"),
        "trace_id": exported.get("trace_id"),
        "parent_id": exported.get("parent_id"),
        "type": span_data.get("type") or "span",
        "name": _span_name(span_data),
        "started_at": started_at,
        "ended_at": ended_at,
        "duration_ms": _duration_ms(started_at, ended_at),
        "reasoning": reasoning,
        "data": cleaned_data,
        "usage": usage,
        "error": exported.get("error"),
    }


def _normalize_trace_payload(payload: dict[str, Any]) -> dict:
    trace = payload.get("trace") or {}
    spans = payload.get("spans") or []
    spans = sorted(spans, key=lambda item: item.get("started_at") or "")
    starts = [_parse_timestamp(span.get("started_at")) for span in spans]
    ends = [_parse_timestamp(span.get("ended_at")) for span in spans]
    valid_starts = [value for value in starts if value is not None]
    valid_ends = [value for value in ends if value is not None]
    duration = None
    if valid_starts and valid_ends:
        duration = max(0, round((max(valid_ends) - min(valid_starts)).total_seconds() * 1000))
    error_count = sum(1 for span in spans if span.get("error"))
    total_tokens = 0
    prompt_tokens = 0
    completion_tokens = 0
    for span in spans:
        u = span.get("usage") or (span.get("data") or {}).get("usage")
        if isinstance(u, dict):
            total_tokens += int(u.get("total_tokens") or 0)
            prompt_tokens += int(u.get("prompt_tokens") or 0)
            completion_tokens += int(u.get("completion_tokens") or 0)
    return {
        "trace_id": trace.get("id"),
        "workflow_name": trace.get("workflow_name"),
        "group_id": trace.get("group_id"),
        "metadata": trace.get("metadata") or {},
        "spans": spans,
        "summary": {
            "duration_ms": duration,
            "span_count": len(spans),
            "tool_count": sum(1 for span in spans if span.get("type") == "function"),
            "model_count": sum(1 for span in spans if span.get("type") in {"generation", "response"}),
            "error_count": error_count,
            "total_tokens": total_tokens or None,
            "prompt_tokens": prompt_tokens or None,
            "completion_tokens": completion_tokens or None,
        },
    }


def _ensure_local_trace_processor(set_trace_processors: Any) -> None:
    global _TRACE_PROCESSOR_CONFIGURED
    if _TRACE_PROCESSOR_CONFIGURED:
        return
    with _TRACE_PROCESSOR_LOCK:
        if _TRACE_PROCESSOR_CONFIGURED:
            return
        # Replace the SDK's default OpenAI backend exporter so traces stay local to Memoria.
        set_trace_processors([_LOCAL_TRACE_PROCESSOR])
        _TRACE_PROCESSOR_CONFIGURED = True



def _get_agent_tools_schema(include_kb: bool = True, include_host: bool = True) -> list[dict]:
    schemas = []
    if include_kb:
        schemas.extend([
        {
            "type": "function",
            "function": {
                "name": "list_knowledge_bases",
                "description": "查询当前允许访问的所有可用知识库列表及文档统计信息。",
                "parameters": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": False,
                },
            },
        },
        {
            "type": "function",
            "function": {
                "name": "search_knowledge_base",
                "description": "在指定的知识库中检索与问题相关的文本片段与参考资料。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "kb_id": {
                            "type": "string",
                            "description": "要检索的知识库ID",
                        },
                        "query": {
                            "type": "string",
                            "description": "检索关键词或查询问题",
                        },
                        "top_k": {
                            "type": "integer",
                            "description": "返回最相关的片段数量，默认5",
                            "default": 5,
                        },
                    },
                    "required": ["kb_id", "query"],
                    "additionalProperties": False,
                },
            },
        },
        ])
    if include_host:
        schemas.extend([
            {
                "type": "function",
                "function": {
                    "name": "list_hosts",
                    "description": "查询当前允许访问的所有远程主机与服务器列表及基本状态。",
                    "parameters": {
                        "type": "object",
                        "properties": {},
                        "additionalProperties": False,
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "get_host_info",
                    "description": "获取指定远程主机的系统配置与运行状态详情（如操作系统、CPU负载、内存及磁盘信息）。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "host_id": {"type": "string", "description": "要查询的主机ID"},
                        },
                        "required": ["host_id"],
                        "additionalProperties": False,
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "run_host_command",
                    "description": "在指定的主机上执行安全的只读/状态查询指令（如 uptime, df -h, free -m, ps, docker ps 等）。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "host_id": {"type": "string", "description": "要执行命令的主机ID"},
                            "command": {"type": "string", "description": "要执行的Shell命令"},
                        },
                        "required": ["host_id", "command"],
                        "additionalProperties": False,
                    },
                },
            },
        ])
    return schemas


async def _execute_agent_tool_async(
    name: str,
    args: dict,
    tools: Any,
    event_queue: Any = None,
    session_id: str | None = None,
) -> Any:
    if name == "list_knowledge_bases":
        return tools.list_knowledge_bases()
    elif name == "search_knowledge_base":
        kb_id = str(args.get("kb_id") or "")
        query = str(args.get("query") or "")
        top_k = int(args.get("top_k") or 5)
        return tools.search_knowledge_base(kb_id, query, top_k)
    elif name == "list_hosts":
        return tools.list_hosts()
    elif name == "get_host_info":
        host_id = str(args.get("host_id") or "")
        return tools.get_host_info(host_id)
    elif name == "run_host_command":
        host_id = str(args.get("host_id") or "")
        command = str(args.get("command") or "")
        
        # Check if approval is required before execution
        h = getattr(tools, "db", None) and tools.db.get_host(host_id)
        host_sec_modes = getattr(tools, "host", None) and getattr(tools.host, "host_security_modes", None)
        override_mode = (host_sec_modes or {}).get(host_id) if host_sec_modes else None
        sec_mode = override_mode or (h.get("security_mode") if h else "ask_confirmation") or ("read_only" if (h and h.get("safe_mode")) else "ask_confirmation")
        
        from memoria.connectors.host.guard import CommandGuard
        import json
        from memoria.config import DEFAULT_HOST_DANGEROUS_PATTERNS
        raw_patterns = tools.db.get_setting("host_dangerous_patterns") if getattr(tools, "db", None) else None
        dangerous_patterns = json.loads(raw_patterns) if raw_patterns else DEFAULT_HOST_DANGEROUS_PATTERNS
        guard = CommandGuard(security_mode=sec_mode, dangerous_patterns=dangerous_patterns)
        
        # If not safe and ask_confirmation mode, trigger approval flow
        if sec_mode == "ask_confirmation" and not guard.is_safe_command(command):
            from memoria.connectors.host.approval import global_host_approval_manager
            host_name = h.get("name") if h else host_id
            approval = global_host_approval_manager.create_approval(
                host_id=host_id,
                host_name=host_name,
                command=command,
                session_id=session_id,
            )
            if event_queue:
                event_queue.put({
                    "type": "approval_required",
                    "approval_id": approval.id,
                    "host_id": host_id,
                    "host_name": host_name,
                    "command": command,
                })
            # Wait for decision
            approved = await global_host_approval_manager.wait_for_decision(approval.id, timeout=300.0)
            if not approved:
                return {
                    "error": f"Command execution rejected by user or timed out: '{command}'",
                    "status": "rejected",
                }
            return tools.run_host_command(host_id, command, approved=True)
            
        return tools.run_host_command(host_id, command)
    else:
        raise ValueError(f"Unknown agent tool: {name}")

def _execute_agent_tool(name: str, args: dict, tools: Any) -> Any:
    if name == "list_knowledge_bases":
        return tools.list_knowledge_bases()
    elif name == "search_knowledge_base":
        kb_id = str(args.get("kb_id") or "")
        query = str(args.get("query") or "")
        top_k = int(args.get("top_k") or 5)
        return tools.search_knowledge_base(kb_id, query, top_k)
    elif name == "list_hosts":
        return tools.list_hosts()
    elif name == "get_host_info":
        host_id = str(args.get("host_id") or "")
        return tools.get_host_info(host_id)
    elif name == "run_host_command":
        host_id = str(args.get("host_id") or "")
        command = str(args.get("command") or "")
        return tools.run_host_command(host_id, command)
    else:
        raise ValueError(f"Unknown agent tool: {name}")

class OpenAIAgentsRunner:
    """Thin boundary around the optional OpenAI Agents SDK.

    Keeping SDK-specific code here makes the independent agentic route importable
    and testable even when the optional ``openai-agents`` package is not installed.
    """

    def __init__(self, base_url: str, api_key: str) -> None:
        self._base_url = base_url
        self._api_key = api_key

    def run(
        self,
        message: str,
        instructions: str,
        tools: Any,
        model_name: str,
        session_id: str | None = None,
        tools_schema: list[dict] | None = None,
    ) -> AgentRunnerOutput:
        try:
            from openai import AsyncOpenAI
            from agents import Agent, RunConfig, Runner, function_tool, gen_trace_id, set_trace_processors
            from agents.models.openai_chatcompletions import OpenAIChatCompletionsModel
        except ImportError as e:
            raise AgenticSdkUnavailable(
                "OpenAI Agents SDK is not installed. Install Memoria with the 'agents' extra "
                "or add the optional 'openai-agents' package to enable agentic chat."
            ) from e

        _ensure_local_trace_processor(set_trace_processors)
        trace_id = gen_trace_id()

        agent_tools = []
        if tools_schema is None:
            tools_schema = _get_agent_tools_schema()

        tool_names = {t["function"]["name"] for t in tools_schema}

        if "list_knowledge_bases" in tool_names:
            @function_tool
            def list_knowledge_bases() -> list[dict]:
                """List knowledge bases this agent is allowed to use."""
                return tools.list_knowledge_bases()
            agent_tools.append(list_knowledge_bases)

        if "search_knowledge_base" in tool_names:
            @function_tool
            def search_knowledge_base(kb_id: str, query: str, top_k: int = 5) -> list[dict]:
                """Search one allowed Memoria knowledge base and return matching chunks."""
                return tools.search_knowledge_base(kb_id, query, top_k)
            agent_tools.append(search_knowledge_base)

        if "list_hosts" in tool_names:
            @function_tool
            def list_hosts() -> list[dict]:
                """List hosts this agent is allowed to inspect."""
                return tools.list_hosts()
            agent_tools.append(list_hosts)

        if "get_host_info" in tool_names:
            @function_tool
            def get_host_info(host_id: str) -> dict:
                """Get detailed runtime info and status for a host."""
                return tools.get_host_info(host_id)
            agent_tools.append(get_host_info)

        if "run_host_command" in tool_names:
            @function_tool
            def run_host_command(host_id: str, command: str) -> dict:
                """Run a safe status inspection command on a host."""
                return tools.run_host_command(host_id, command)
            agent_tools.append(run_host_command)

        client = AsyncOpenAI(base_url=self._base_url, api_key=self._api_key)
        model = OpenAIChatCompletionsModel(model=model_name, openai_client=client)
        agent = Agent(
            name="Memoria AI Agent",
            instructions=instructions,
            model=model,
            tools=agent_tools,
        )
        run_config = RunConfig(
            tracing_disabled=False,
            trace_include_sensitive_data=False,
            workflow_name="Memoria agentic chat",
            trace_id=trace_id,
            group_id=session_id,
            trace_metadata={"session_id": session_id, "model": model_name},
        )

        async def _run() -> AgentRunnerOutput:
            result = await Runner.run(agent, message, run_config=run_config)
            trace = _LOCAL_TRACE_PROCESSOR.pop_trace(trace_id)
            return AgentRunnerOutput(answer=str(result.final_output), trace=trace)

        try:
            return asyncio.run(_run())
        except RuntimeError as e:
            # If a future ASGI path already owns an event loop, surface a clear 502-style error
            # instead of hiding it in an SDK traceback.
            if "asyncio.run() cannot be called" in str(e):
                raise RuntimeError("Agentic chat runner cannot start inside an existing event loop") from e
            raise



    def run_stream(
        self,
        message: str,
        instructions: str,
        tools: Any,
        model_name: str,
        tools_schema: list[dict] | None = None,
        session_id: str | None = None,
        max_turns: int = 6,
    ) -> Iterator[dict[str, Any]]:
        import queue
        import uuid
        import time
        from openai import AsyncOpenAI

        event_queue: queue.Queue[dict[str, Any] | None] = queue.Queue()
        trace_id = f"trace-{uuid.uuid4().hex[:12]}"
        spans: list[dict[str, Any]] = []

        if tools_schema is None:
            tools_schema = _get_agent_tools_schema()
        agent_span_id = f"span-agent-{uuid.uuid4().hex[:8]}"
        agent_span = {
            "id": agent_span_id,
            "trace_id": trace_id,
            "parent_id": None,
            "type": "agent",
            "name": "Memoria AI Agent",
            "started_at": datetime.utcnow().isoformat() + "Z",
            "ended_at": None,
            "duration_ms": None,
            "data": {
                "input": message,
                "tools": [t["function"]["name"] for t in tools_schema],
            },
            "error": None,
        }
        spans.append(agent_span)
        event_queue.put({
            "type": "trace_span",
            "phase": "start",
            "span": dict(agent_span),
        })

        async def _async_worker():
            try:
                client = AsyncOpenAI(base_url=self._base_url, api_key=self._api_key)
                messages: list[dict[str, Any]] = [
                    {"role": "system", "content": instructions},
                    {"role": "user", "content": message},
                ]

                turn = 0
                final_answer = ""
                collected_thought = ""

                while turn < max_turns:
                    turn += 1
                    gen_span_id = f"span-gen-{turn}-{uuid.uuid4().hex[:6]}"
                    gen_start = time.time()
                    gen_span = {
                        "id": gen_span_id,
                        "trace_id": trace_id,
                        "parent_id": agent_span_id,
                        "type": "generation",
                        "name": model_name,
                        "started_at": datetime.utcnow().isoformat() + "Z",
                        "ended_at": None,
                        "duration_ms": None,
                        "data": {
                            "input": copy.deepcopy(messages),
                        },
                        "error": None,
                    }
                    spans.append(gen_span)
                    event_queue.put({
                        "type": "trace_span",
                        "phase": "start",
                        "span": dict(gen_span),
                    })

                    create_kwargs: dict[str, Any] = {
                        "model": model_name,
                        "messages": messages,
                        "stream_options": {"include_usage": True},
                        "stream": True,
                    }
                    if tools_schema:
                        create_kwargs["tools"] = tools_schema
                    stream = await client.chat.completions.create(**create_kwargs)

                    current_content = ""
                    current_thought = ""
                    tool_calls_acc: dict[int, dict[str, Any]] = {}
                    gen_usage = None

                    async for chunk in stream:
                        if getattr(chunk, "usage", None):
                            u = chunk.usage
                            gen_usage = {
                                "prompt_tokens": getattr(u, "prompt_tokens", None),
                                "completion_tokens": getattr(u, "completion_tokens", None),
                                "total_tokens": getattr(u, "total_tokens", None),
                            }
                        elif isinstance(chunk, dict) and chunk.get("usage"):
                            gen_usage = chunk["usage"]
                        if not chunk.choices:
                            continue
                        delta = chunk.choices[0].delta

                        reasoning = (
                            getattr(delta, "reasoning_content", None)
                            or getattr(delta, "thought", None)
                            or getattr(delta, "reasoning", None)
                        )
                        if reasoning:
                            current_thought += reasoning
                            collected_thought += reasoning
                            event_queue.put({
                                "type": "thought_delta",
                                "delta": reasoning,
                            })

                        if delta.content:
                            current_content += delta.content
                            event_queue.put({
                                "type": "answer_delta",
                                "delta": delta.content,
                            })

                        if delta.tool_calls:
                            for tc in delta.tool_calls:
                                idx = tc.index
                                if idx not in tool_calls_acc:
                                    tool_calls_acc[idx] = {
                                        "id": tc.id or f"call_{uuid.uuid4().hex[:8]}",
                                        "name": tc.function.name if tc.function and tc.function.name else "",
                                        "arguments": "",
                                    }
                                if tc.id:
                                    tool_calls_acc[idx]["id"] = tc.id
                                if tc.function:
                                    if tc.function.name:
                                        tool_calls_acc[idx]["name"] = tc.function.name
                                    if tc.function.arguments:
                                        tool_calls_acc[idx]["arguments"] += tc.function.arguments

                    gen_end = time.time()
                    gen_span["ended_at"] = datetime.utcnow().isoformat() + "Z"
                    gen_span["duration_ms"] = max(0, round((gen_end - gen_start) * 1000))
                    
                    # Unified output structure
                    gen_output: dict[str, Any] = {}
                    if current_thought:
                        gen_span["reasoning"] = current_thought
                        gen_output["thought"] = current_thought
                    if tool_calls_acc:
                        gen_output["tool_calls"] = list(tool_calls_acc.values())
                    if current_content:
                        gen_output["content"] = current_content

                    if gen_usage:
                        gen_output["usage"] = gen_usage
                    gen_span["data"]["output"] = gen_output if gen_output else (current_content or None)
                    gen_span["usage"] = gen_usage

                    event_queue.put({
                        "type": "trace_span",
                        "phase": "end",
                        "span": dict(gen_span),
                    })

                    if not tool_calls_acc:
                        final_answer = current_content
                        break

                    assistant_msg: dict[str, Any] = {
                        "role": "assistant",
                        "content": current_content or None,
                        "tool_calls": [
                            {
                                "id": tc["id"],
                                "type": "function",
                                "function": {
                                    "name": tc["name"],
                                    "arguments": tc["arguments"],
                                },
                            }
                            for tc in tool_calls_acc.values()
                        ],
                    }
                    messages.append(assistant_msg)

                    for tc in tool_calls_acc.values():
                        tool_name = tc["name"]
                        raw_args = tc["arguments"]
                        args = _safe_parse_json_or_literal(raw_args) or {}
                        if not isinstance(args, dict):
                            args = {}

                        tool_span_id = f"span-tool-{uuid.uuid4().hex[:8]}"
                        tool_start = time.time()
                        tool_span = {
                            "id": tool_span_id,
                            "trace_id": trace_id,
                            "parent_id": agent_span_id,
                            "type": "function",
                            "name": tool_name,
                            "started_at": datetime.utcnow().isoformat() + "Z",
                            "ended_at": None,
                            "duration_ms": None,
                            "data": {
                                "name": tool_name,
                                "input": args,
                            },
                            "error": None,
                        }
                        spans.append(tool_span)

                        event_queue.put({
                            "type": "trace_span",
                            "phase": "start",
                            "span": dict(tool_span),
                        })

                        tool_error = None
                        tool_result = None
                        try:
                            tool_result = await _execute_agent_tool_async(
                                tool_name,
                                args,
                                tools,
                                event_queue=event_queue,
                                session_id=session_id,
                            )
                        except Exception as e:
                            tool_error = str(e)
                            tool_result = {"error": str(e)}

                        tool_end = time.time()
                        tool_span["ended_at"] = datetime.utcnow().isoformat() + "Z"
                        tool_span["duration_ms"] = max(0, round((tool_end - tool_start) * 1000))
                        tool_span["data"]["output"] = tool_result
                        if tool_error:
                            tool_span["error"] = tool_error

                        event_queue.put({
                            "type": "trace_span",
                            "phase": "end",
                            "span": dict(tool_span),
                        })

                        messages.append({
                            "role": "tool",
                            "tool_call_id": tc["id"],
                            "content": json.dumps(tool_result, ensure_ascii=False) if not isinstance(tool_result, str) else tool_result,
                        })

                agent_span["ended_at"] = datetime.utcnow().isoformat() + "Z"
                total_duration = sum(s.get("duration_ms", 0) or 0 for s in spans)
                agent_span["duration_ms"] = total_duration
                agent_span["data"]["output"] = final_answer
                if collected_thought:
                    agent_span["reasoning"] = collected_thought
                    agent_span["data"]["thought"] = collected_thought

                event_queue.put({
                    "type": "trace_span",
                    "phase": "end",
                    "span": dict(agent_span),
                })

                total_tokens = 0
                prompt_tokens = 0
                completion_tokens = 0
                for s in spans:
                    u = s.get("usage") or (s.get("data") or {}).get("usage")
                    if isinstance(u, dict):
                        total_tokens += int(u.get("total_tokens") or 0)
                        prompt_tokens += int(u.get("prompt_tokens") or 0)
                        completion_tokens += int(u.get("completion_tokens") or 0)

                final_trace = {
                    "trace_id": trace_id,
                    "workflow_name": "Memoria AI Agent",
                    "group_id": session_id,
                    "metadata": {
                        "session_id": session_id,
                        "model": model_name,
                        "thought": collected_thought,
                    },
                    "spans": spans,
                    "summary": {
                        "duration_ms": total_duration,
                        "reasoning": collected_thought or None,
                        "span_count": len(spans),
                        "tool_count": sum(1 for s in spans if s.get("type") == "function"),
                        "model_count": sum(1 for s in spans if s.get("type") == "generation"),
                        "error_count": sum(1 for s in spans if s.get("error")),
                        "total_tokens": total_tokens or None,
                        "prompt_tokens": prompt_tokens or None,
                        "completion_tokens": completion_tokens or None,
                    },
                }

                event_queue.put({
                    "type": "done",
                    "answer": final_answer,
                    "trace": final_trace,
                })
            except Exception as e:
                logger.exception("Streaming agent error: %s", e)
                event_queue.put({"type": "error", "detail": str(e)})
            finally:
                event_queue.put(None)

        def _thread_target():
            asyncio.run(_async_worker())

        worker_thread = threading.Thread(target=_thread_target, daemon=True)
        worker_thread.start()

        while True:
            event = event_queue.get()
            if event is None:
                break
            yield event


class MockAgentRunner:
    """Deterministic no-network runner used when USE_MOCK=true."""

    def run(
        self,
        message: str,
        instructions: str,
        tools: AgentKnowledgeTools,
        model_name: str,
        session_id: str | None = None,
        tools_schema: list[dict] | None = None,
    ) -> AgentRunnerOutput:
        for kb in tools.list_knowledge_bases():
            tools.search_knowledge_base(kb["id"], message, top_k=3)
        if hasattr(tools, "list_hosts"):
            for host in tools.list_hosts():
                tools.get_host_info(host["id"])
                break
        return AgentRunnerOutput(answer="[mock agentic response]")


@dataclass
@dataclass
class AgenticRagEngine:
    db: DB
    pipeline: "Pipeline"
    runner: AgentRunner | None = None
    max_sources: int = 20
    history_limit: int = 12

    def run(
        self,
        message: str,
        session_id: str | None = None,
        bot_id: str | None = None,
    ) -> dict:
        if not message or not message.strip():
            raise ValueError("Query must not be empty")

        from memoria.config import get_effective_settings
        effective = get_effective_settings(self.db)

        bot = None
        if bot_id is not None:
            bot = self.db.get_bot(bot_id)
            if bot is None:
                raise ValueError(f"Bot {bot_id} not found")
            allowed_kb_ids = bot.get("kb_ids") or []
            allowed_host_ids = bot.get("host_ids") or []
            if session_id is not None:
                sess = self.db.get_bot_session(session_id, bot_id)
                if sess is None:
                    raise ValueError(f"session {session_id} not found for bot {bot_id}")
            else:
                sess = self.db.create_session(bot_id, title=message)
                session_id = sess["id"]
            system_prompt = bot.get("system_prompt") or effective.get("system_prompt") or ""
            instructions = self._instructions(effective, custom_system_prompt=system_prompt, is_bot=True)
            host_security_modes = bot.get("host_security_modes") or {}
        else:
            allowed_kb_ids = [kb["id"] for kb in self.db.list_kbs()]
            allowed_host_ids = [h["id"] for h in self.db.list_hosts()]
            host_security_modes = {}
            if session_id is not None:
                sess = self.db.get_agentic_session(session_id)
                if sess is None:
                    raise ValueError(f"agentic session {session_id} not found")
            else:
                sess = self.db.create_agentic_session(message)
                session_id = sess["id"]
            instructions = self._instructions(effective, is_bot=False)

        collector = SourceCollector(max_sources=self.max_sources)
        tools = AgentTools.create(
            db=self.db,
            pipeline=self.pipeline,
            allowed_kb_ids=allowed_kb_ids,
            allowed_host_ids=allowed_host_ids,
            collector=collector,
            host_security_modes=host_security_modes,
        )
        tools_schema = _get_agent_tools_schema(
            include_kb=bool(allowed_kb_ids),
            include_host=bool(allowed_host_ids),
        )

        history = self.db.get_messages(session_id, limit=self.history_limit)
        prompt = self._build_prompt(message, history)

        runner = self.runner or self._default_runner(effective)
        logger.debug("agent/bot chat: session=%s bot=%s allowed_kbs=%s allowed_hosts=%s", session_id, bot_id, allowed_kb_ids, allowed_host_ids)
        runner_output = runner.run(
            prompt,
            instructions,
            tools,
            effective["llm_model"],
            session_id=session_id,
            tools_schema=tools_schema,
        )
        if isinstance(runner_output, AgentRunnerOutput):
            answer = runner_output.answer
            trace = runner_output.trace
        else:
            answer = str(runner_output)
            trace = None
        sources = collector.list_sources()
        used_kbs = collector.used_kbs()

        self.db.add_message(session_id, "user", message)
        assistant_message = self.db.add_message(session_id, "assistant", answer, sources=sources)
        stored_trace = self.db.add_message_trace(session_id, assistant_message["id"], trace) if trace else None

        return {
            "answer": answer,
            "session_id": session_id,
            "used_kbs": used_kbs,
            "sources": sources,
            "trace": stored_trace,
        }

    def run_stream(
        self,
        message: str,
        session_id: str | None = None,
        bot_id: str | None = None,
    ) -> Iterator[dict[str, Any]]:
        if not message or not message.strip():
            raise ValueError("Query must not be empty")

        from memoria.config import get_effective_settings
        effective = get_effective_settings(self.db)

        bot = None
        if bot_id is not None:
            bot = self.db.get_bot(bot_id)
            if bot is None:
                raise ValueError(f"Bot {bot_id} not found")
            allowed_kb_ids = bot.get("kb_ids") or []
            allowed_host_ids = bot.get("host_ids") or []
            if session_id is not None:
                sess = self.db.get_bot_session(session_id, bot_id)
                if sess is None:
                    raise ValueError(f"session {session_id} not found for bot {bot_id}")
            else:
                sess = self.db.create_session(bot_id, title=message)
                session_id = sess["id"]
            system_prompt = bot.get("system_prompt") or effective.get("system_prompt") or ""
            instructions = self._instructions(effective, custom_system_prompt=system_prompt, is_bot=True)
            host_security_modes = bot.get("host_security_modes") or {}
        else:
            allowed_kb_ids = [kb["id"] for kb in self.db.list_kbs()]
            allowed_host_ids = [h["id"] for h in self.db.list_hosts()]
            host_security_modes = {}
            if session_id is not None:
                sess = self.db.get_agentic_session(session_id)
                if sess is None:
                    raise ValueError(f"agentic session {session_id} not found")
            else:
                sess = self.db.create_agentic_session(message)
                session_id = sess["id"]
            instructions = self._instructions(effective, is_bot=False)

        collector = SourceCollector(max_sources=self.max_sources)
        tools = AgentTools.create(
            db=self.db,
            pipeline=self.pipeline,
            allowed_kb_ids=allowed_kb_ids,
            allowed_host_ids=allowed_host_ids,
            collector=collector,
            host_security_modes=host_security_modes,
        )
        tools_schema = _get_agent_tools_schema(
            include_kb=bool(allowed_kb_ids),
            include_host=bool(allowed_host_ids),
        )
        history = self.db.get_messages(session_id, limit=self.history_limit)
        prompt = self._build_prompt(message, history)

        runner = self.runner or self._default_runner(effective)

        self.db.add_message(session_id, "user", message)

        yield {
            "type": "init",
            "session_id": session_id,
        }

        final_answer = ""
        final_trace = None

        if hasattr(runner, "run_stream"):
            for event in runner.run_stream(
                prompt,
                instructions,
                tools,
                effective["llm_model"],
                session_id=session_id,
                tools_schema=tools_schema,
            ):
                if event.get("type") == "done":
                    final_answer = event.get("answer") or ""
                    final_trace = event.get("trace")
                else:
                    yield event
        else:
            runner_output = runner.run(
                prompt,
                instructions,
                tools,
                effective["llm_model"],
                session_id=session_id,
                tools_schema=tools_schema,
            )
            if isinstance(runner_output, AgentRunnerOutput):
                final_answer = runner_output.answer
                final_trace = runner_output.trace
            else:
                final_answer = str(runner_output)
            yield {"type": "answer_delta", "delta": final_answer}

        sources = collector.list_sources()
        used_kbs = collector.used_kbs()

        assistant_message = self.db.add_message(session_id, "assistant", final_answer, sources=sources)
        stored_trace = self.db.add_message_trace(session_id, assistant_message["id"], final_trace) if final_trace else None

        yield {
            "type": "done",
            "session_id": session_id,
            "answer": final_answer,
            "sources": sources,
            "used_kbs": used_kbs,
            "trace": stored_trace,
        }

    def _build_prompt(self, message: str, history: list[dict]) -> str:
        if not history:
            return message

        transcript: list[str] = ["以下是本会话此前的对话上下文，请结合它回答当前问题："]
        for item in history:
            role = "用户" if item.get("role") == "user" else "助手"
            content = str(item.get("content") or "").strip()
            if content:
                transcript.append(f"{role}：{content}")
        transcript.append("")
        transcript.append(f"当前用户问题：{message}")
        return "\n".join(transcript)

    def _default_runner(self, effective: dict) -> AgentRunner:
        from memoria.config import settings

        if settings.use_mock:
            return MockAgentRunner()
        return OpenAIAgentsRunner(effective["openai_base_url"], effective["openai_api_key"])

    def _instructions(
        self,
        effective: dict,
        custom_system_prompt: str | None = None,
        is_bot: bool = False,
    ) -> str:
        base_prompt = custom_system_prompt if (custom_system_prompt is not None and custom_system_prompt != "") else (effective.get("system_prompt") or "")
        if is_bot:
            role_desc = (
                "You are an AI assistant in Memoria configured for this specific bot. "
                "You have access to tools specifically configured for this bot (such as bound knowledge bases and host servers). "
                "When the user asks questions or issues commands, select and use the available tools as appropriate."
            )
        else:
            role_desc = (
                "You are Memoria's independent AI Agent assistant. You can access every knowledge base "
                "and host server available in the system. When the user asks questions or issues tasks, "
                "freely inspect and utilize all available tools to accomplish the goal."
            )
        return f"{base_prompt}\n\n{role_desc}".strip()

