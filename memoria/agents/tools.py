from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from memoria.agents.state import SourceCollector
from memoria.connectors.host.tools import AgentHostTools, HOST_TOOL_METADATA

if TYPE_CHECKING:
    from memoria.core.pipeline import Pipeline
    from memoria.storage.db import DB
    from memoria.connectors.registry import ConnectorRegistry


TOOL_METADATA: dict[str, dict[str, str]] = {
    "list_knowledge_bases": {
        "label": "查询可用知识库",
        "description": "获取当前允许访问的所有知识库元数据与文档总数",
        "agent_id": "knowledge_agent",
        "agent_name": "KnowledgeAgent",
        "agent_role": "specialist",
        "parent_agent_id": "orchestrator",
    },
    "search_knowledge_base": {
        "label": "检索知识库内容",
        "description": "在指定知识库中执行向量与关键字混合检索，返回高相关文本片段",
        "agent_id": "knowledge_agent",
        "agent_name": "KnowledgeAgent",
        "agent_role": "specialist",
        "parent_agent_id": "orchestrator",
    },
    "delegate_to_knowledge_agent": {
        "label": "委派知识库专家",
        "description": "委派专精于文档检索与内容提炼的 KnowledgeAgent 处理知识库相关问题",
        "agent_id": "knowledge_agent",
        "agent_name": "KnowledgeAgent",
        "agent_role": "specialist",
        "parent_agent_id": "orchestrator",
    },
    "delegate_to_host_agent": {
        "label": "委派主机运维专家",
        "description": "委派专精于远程服务器探查与受控命令执行的 HostAgent 处理主机运维任务",
        "agent_id": "host_agent",
        "agent_name": "HostAgent",
        "agent_role": "specialist",
        "parent_agent_id": "orchestrator",
    },
    **HOST_TOOL_METADATA,
}


class KnowledgeBaseAccessError(ValueError):
    """Raised when the agent tries to access a KB outside its allowed scope."""


@dataclass
class AgentKnowledgeTools:
    db: "DB"
    pipeline: "Pipeline"
    allowed_kb_ids: list[str]
    collector: SourceCollector
    max_top_k: int = 8

    def __post_init__(self) -> None:
        self._allowed = set(self.allowed_kb_ids)

    def _ensure_allowed(self, kb_id: str) -> None:
        if kb_id not in self._allowed:
            raise KnowledgeBaseAccessError(f"Knowledge base {kb_id} is not allowed for this agent chat")
        if self.db.get_kb(kb_id) is None:
            raise ValueError(f"Knowledge base {kb_id} not found")

    def list_knowledge_bases(self) -> list[dict]:
        """Return compact metadata for KBs this agent may inspect."""
        summaries: list[dict] = []
        for kb in self.db.list_kbs():
            if kb["id"] not in self._allowed:
                continue
            docs = self.db.list_docs(kb["id"])
            summaries.append({
                "id": kb["id"],
                "name": kb["name"],
                "description": kb.get("description") or "",
                "type": kb.get("type") or "upload",
                "document_count": len(docs),
            })
        return summaries

    def search_knowledge_base(self, kb_id: str, query: str, top_k: int = 5) -> list[dict]:
        """Search one allowed KB through Memoria's existing retrieval pipeline."""
        self._ensure_allowed(kb_id)
        if not query or not query.strip():
            raise ValueError("Query must not be empty")
        top_k = max(1, min(int(top_k or 5), self.max_top_k))
        chunks = self.pipeline.retrieve(kb_id, query, k=top_k)
        results: list[dict] = []
        for chunk in chunks:
            db_doc_id = str(chunk.get("db_doc_id") or "")
            doc_info = self.db.get_doc(db_doc_id) if db_doc_id else None
            source = self.collector.add_chunk(kb_id, chunk, doc_info)
            results.append({
                "kb_id": kb_id,
                "text": source["text"],
                "score": source["score"],
                "doc_id": source["doc_id"],
                "db_doc_id": source["db_doc_id"],
                "filename": source["filename"],
                "path": source["path"],
                "source": source["source"],
            })
        return results


@dataclass
class AgentTools:
    """Unified tool container aggregating Knowledge, Host, and other pluggable tools."""
    knowledge: AgentKnowledgeTools
    host: AgentHostTools

    @classmethod
    def create(
        cls,
        db: "DB",
        pipeline: "Pipeline",
        allowed_kb_ids: list[str],
        allowed_host_ids: list[str],
        collector: SourceCollector,
        registry: "ConnectorRegistry | None" = None,
        max_top_k: int = 8,
        host_security_modes: dict[str, str] | None = None,
    ) -> "AgentTools":
        kt = AgentKnowledgeTools(
            db=db,
            pipeline=pipeline,
            allowed_kb_ids=allowed_kb_ids,
            collector=collector,
            max_top_k=max_top_k,
        )
        ht = AgentHostTools(
            db=db,
            allowed_host_ids=allowed_host_ids,
            collector=collector,
            registry=registry,
            host_security_modes=host_security_modes,
        )
        return cls(knowledge=kt, host=ht)

    # Delegate knowledge base tools
    def list_knowledge_bases(self) -> list[dict]:
        return self.knowledge.list_knowledge_bases()

    def search_knowledge_base(self, kb_id: str, query: str, top_k: int = 5) -> list[dict]:
        return self.knowledge.search_knowledge_base(kb_id, query, top_k)

    # Delegate host tools
    def list_hosts(self) -> list[dict]:
        return self.host.list_hosts()

    def get_host_info(self, host_id: str) -> dict:
        return self.host.get_host_info(host_id)

    def run_host_command(self, host_id: str, command: str, approved: bool = False) -> dict:
        return self.host.run_host_command(host_id, command, approved=approved)

    def delegate_to_knowledge_agent(self, query: str, kb_id: str | None = None, top_k: int = 5) -> dict:
        """Subagent action: Retrieve information across knowledge bases and return summarized findings."""
        if kb_id:
            results = self.search_knowledge_base(kb_id=kb_id, query=query, top_k=top_k)
            return {
                "status": "success",
                "agent": "KnowledgeAgent",
                "kb_id": kb_id,
                "result_count": len(results),
                "chunks": results,
            }
        kbs = self.list_knowledge_bases()
        all_results = []
        for kb in kbs:
            if kb.get("document_count", 0) > 0:
                try:
                    res = self.search_knowledge_base(kb_id=kb["id"], query=query, top_k=top_k)
                    all_results.extend(res)
                except Exception:
                    continue
        return {
            "status": "success",
            "agent": "KnowledgeAgent",
            "kbs_searched": len(kbs),
            "result_count": len(all_results),
            "chunks": all_results,
        }

    def delegate_to_host_agent(self, instruction: str, host_id: str | None = None, command: str | None = None) -> dict:
        """Subagent action: Dispatch host inspection or operations through HostAgent."""
        if command and host_id:
            return self.run_host_command(host_id=host_id, command=command)
        if host_id:
            return self.get_host_info(host_id=host_id)
        hosts = self.list_hosts()
        return {
            "status": "success",
            "agent": "HostAgent",
            "hosts_available": len(hosts),
            "hosts": hosts,
            "instruction": instruction,
        }
