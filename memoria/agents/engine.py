from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

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


class AgentRunner(Protocol):
    def run(self, message: str, instructions: str, tools: AgentKnowledgeTools, model_name: str) -> str:
        ...


class OpenAIAgentsRunner:
    """Thin boundary around the optional OpenAI Agents SDK.

    Keeping SDK-specific code here makes the independent agentic route importable
    and testable even when the optional ``openai-agents`` package is not installed.
    """

    def __init__(self, base_url: str, api_key: str) -> None:
        self._base_url = base_url
        self._api_key = api_key

    def run(self, message: str, instructions: str, tools: AgentKnowledgeTools, model_name: str) -> str:
        try:
            from openai import AsyncOpenAI
            from agents import Agent, Runner, function_tool, set_tracing_disabled
            from agents.models.openai_chatcompletions import OpenAIChatCompletionsModel
        except ImportError as e:
            raise AgenticSdkUnavailable(
                "OpenAI Agents SDK is not installed. Install Memoria with the 'agents' extra "
                "or add the optional 'openai-agents' package to enable agentic chat."
            ) from e

        set_tracing_disabled(True)

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

        async def _run() -> str:
            result = await Runner.run(agent, message)
            return str(result.final_output)

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

    def run(self, message: str, instructions: str, tools: AgentKnowledgeTools, model_name: str) -> str:
        for kb in tools.list_knowledge_bases():
            tools.search_knowledge_base(kb["id"], message, top_k=3)
        return "[mock agentic response]"


@dataclass
class AgenticRagEngine:
    db: DB
    pipeline: "Pipeline"
    runner: AgentRunner | None = None
    max_sources: int = 20

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

        runner = self.runner or self._default_runner(effective)
        instructions = self._instructions(effective)
        logger.debug("agentic chat: session=%s allowed_kbs=%s", session_id, allowed_kb_ids)
        answer = runner.run(message, instructions, tools, effective["llm_model"])
        sources = collector.list_sources()
        used_kbs = collector.used_kbs()

        self.db.add_message(session_id, "user", message)
        self.db.add_message(session_id, "assistant", answer, sources=sources)

        return {
            "answer": answer,
            "session_id": session_id,
            "used_kbs": used_kbs,
            "sources": sources,
        }

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
