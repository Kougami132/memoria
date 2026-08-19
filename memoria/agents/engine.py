from __future__ import annotations

import asyncio
import logging
import threading
from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING, Any, Protocol

from memoria.agents.state import SourceCollector
from memoria.agents.tools import AgentKnowledgeTools
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
        tools: AgentKnowledgeTools,
        model_name: str,
        session_id: str | None = None,
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


def _normalize_span(exported: dict[str, Any]) -> dict:
    span_data = exported.get("span_data") or {}
    started_at = exported.get("started_at")
    ended_at = exported.get("ended_at")
    return {
        "id": exported.get("id"),
        "trace_id": exported.get("trace_id"),
        "parent_id": exported.get("parent_id"),
        "type": span_data.get("type") or "span",
        "name": _span_name(span_data),
        "started_at": started_at,
        "ended_at": ended_at,
        "duration_ms": _duration_ms(started_at, ended_at),
        "data": span_data,
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
        tools: AgentKnowledgeTools,
        model_name: str,
        session_id: str | None = None,
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

        @function_tool
        def list_knowledge_bases() -> list[dict]:
            """List knowledge bases this agent is allowed to use."""
            return tools.list_knowledge_bases()

        @function_tool
        def search_knowledge_base(kb_id: str, query: str, top_k: int = 5) -> list[dict]:
            """Search one allowed Memoria knowledge base and return matching chunks."""
            return tools.search_knowledge_base(kb_id, query, top_k)

        client = AsyncOpenAI(base_url=self._base_url, api_key=self._api_key)
        model = OpenAIChatCompletionsModel(model=model_name, openai_client=client)
        agent = Agent(
            name="Memoria Agentic RAG",
            instructions=instructions,
            model=model,
            tools=[list_knowledge_bases, search_knowledge_base],
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


class MockAgentRunner:
    """Deterministic no-network runner used when USE_MOCK=true."""

    def run(
        self,
        message: str,
        instructions: str,
        tools: AgentKnowledgeTools,
        model_name: str,
        session_id: str | None = None,
    ) -> AgentRunnerOutput:
        for kb in tools.list_knowledge_bases():
            tools.search_knowledge_base(kb["id"], message, top_k=3)
        return AgentRunnerOutput(answer="[mock agentic response]")


@dataclass
class AgenticRagEngine:
    db: DB
    pipeline: "Pipeline"
    runner: AgentRunner | None = None
    max_sources: int = 20
    history_limit: int = 12

    def run(self, message: str, session_id: str | None = None) -> dict:
        if not message or not message.strip():
            raise ValueError("Query must not be empty")

        if session_id is not None:
            sess = self.db.get_agentic_session(session_id)
            if sess is None:
                raise ValueError(f"agentic session {session_id} not found")
        else:
            sess = self.db.create_agentic_session(message)
            session_id = sess["id"]

        from memoria.config import get_effective_settings

        effective = get_effective_settings(self.db)
        allowed_kb_ids = [kb["id"] for kb in self.db.list_kbs()]
        collector = SourceCollector(max_sources=self.max_sources)
        tools = AgentKnowledgeTools(
            db=self.db,
            pipeline=self.pipeline,
            allowed_kb_ids=allowed_kb_ids,
            collector=collector,
        )
        history = self.db.get_messages(session_id, limit=self.history_limit)
        prompt = self._build_prompt(message, history)

        runner = self.runner or self._default_runner(effective)
        instructions = self._instructions(effective)
        logger.debug("agentic chat: session=%s allowed_kbs=%s history=%s", session_id, allowed_kb_ids, len(history))
        runner_output = runner.run(prompt, instructions, tools, effective["llm_model"], session_id=session_id)
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

    def _instructions(self, effective: dict) -> str:
        base_prompt = effective.get("system_prompt") or ""
        return (
            f"{base_prompt}\n\n"
            "You are Memoria's independent agentic RAG assistant. You can access every knowledge "
            "base available in the system. When the user asks about stored knowledge, first inspect "
            "available knowledge bases with list_knowledge_bases, then search the most relevant ones "
            "with search_knowledge_base. Use retrieved evidence when available. If the retrieved "
            "sources are insufficient, say so clearly. Do not invent citations; the backend will "
            "attach structured sources collected from tool execution."
        )
