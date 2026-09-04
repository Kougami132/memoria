from __future__ import annotations

import json
import logging
import os
import threading
from collections.abc import Iterator

from memoria.core.chunker import Chunker
from memoria.core.embedder import Embedder, MockEmbedder
from memoria.llm.caller import LLMCaller, MockLLMCaller
from memoria.storage.chroma_store import ChromaStore
from memoria.storage.db import DB

logger = logging.getLogger(__name__)


class Pipeline:
    def __init__(self, db: DB, embedder: Embedder | MockEmbedder,
                 llm: LLMCaller | MockLLMCaller, chroma_path: str,
                 top_k: int = 5, min_score: float = 0.5,
                 default_system_prompt: str = "") -> None:
        self.db = db
        self._embedder = embedder
        self._llm = llm
        self._chroma_path = chroma_path
        self._top_k = top_k
        self._min_score = min_score
        self._default_system_prompt = default_system_prompt
        self._local = threading.local()  # 每个线程独立的 ChromaStore 缓存

    def _get_store(self, kb_id: str) -> ChromaStore:
        if not hasattr(self._local, 'stores'):
            self._local.stores = {}
        if kb_id not in self._local.stores:
            self._local.stores[kb_id] = ChromaStore(
                path=self._chroma_path,
                collection_name=f"kb_{kb_id}",
            )
        return self._local.stores[kb_id]

    def ingest(self, kb_id: str, path: str, source: str = "upload",
               filename: str | None = None, tmp_path: str | None = None) -> dict:
        chunker_path = tmp_path or path
        chunks = [c for c in Chunker().split(chunker_path) if c.strip()]
        if not chunks:
            raise ValueError("File produced no embeddable content")
        display_name = filename or os.path.basename(path)
        doc_id = display_name.replace(".", "_") + "_" + kb_id[:8]
        vectors = self._embedder.embed(chunks)
        ids = [f"{doc_id}__{i}" for i in range(len(chunks))]
        doc = self.db.create_doc(kb_id, display_name, path, len(chunks), source=source)
        metadatas = [{"doc_id": doc_id, "db_doc_id": doc["id"]} for _ in chunks]
        self._get_store(kb_id).add(ids, vectors, chunks, metadatas)
        return {"doc_id": doc_id, "chunk_count": len(chunks), "doc": doc}

    def delete_doc(self, doc_id: str, kb_id: str) -> None:
        """Delete a document and all vector chunks associated with it."""
        self._get_store(kb_id).delete(where={"db_doc_id": doc_id})
        self.db.delete_doc(doc_id)

    def retrieve(self, kb_id: str, query: str, k: int | None = None) -> list[dict]:
        if not query or not query.strip():
            return []
        embedding = self._embedder.embed([query])[0]
        return self._get_store(kb_id).query(embedding, k=k or self._top_k)

    def _build_sources(self, context_chunks: list[dict]) -> list[dict]:
        sources: list[dict] = []
        for c in context_chunks:
            db_doc_id = c.get("db_doc_id", "")
            doc_info = self.db.get_doc(db_doc_id) if db_doc_id else None
            sources.append({
                "text": c["text"],
                "score": c["score"],
                "doc_id": c["doc_id"],
                "filename": doc_info["filename"] if doc_info else None,
                "path": doc_info["path"] if doc_info else None,
                "source": doc_info["source"] if doc_info else None,
            })
        return sources

    def _persist_response(self, session_id: str, query: str, answer: str, sources: list[dict]) -> None:
        self.db.add_message(session_id, "user", query)
        self.db.add_message(session_id, "assistant", answer, sources=sources)

    def _build_host_tools_schema(self, bound_host_ids: list[str]) -> list[dict]:
        if not bound_host_ids:
            return []
        return [
            {
                "type": "function",
                "function": {
                    "name": "get_host_info",
                    "description": "获取指定主机的运行状态、系统硬件信息及负载概况。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "host_id": {
                                "type": "string",
                                "description": "目标主机ID",
                            },
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
                    "description": "在指定远程主机上执行排查/监控或系统状态查询命令（如 uptime, df -h, free -m, top -b -n 1, ps aux, docker ps 等）。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "host_id": {
                                "type": "string",
                                "description": "目标主机ID",
                            },
                            "command": {
                                "type": "string",
                                "description": "要在远程主机上执行的 shell 命令",
                            },
                        },
                        "required": ["host_id", "command"],
                        "additionalProperties": False,
                    },
                },
            },
        ]

    def _execute_host_tool(self, tool_name: str, args: dict, bot: dict) -> dict:
        bound_host_ids = bot.get("host_ids") or []
        host_id = str(args.get("host_id") or "")
        if host_id not in bound_host_ids:
            return {"error": f"主机 {host_id} 未绑定到当前助手或无权访问"}
        try:
            from memoria.server.deps import get_registry
            from memoria.connectors.base import ResourceType
            registry = get_registry()
        except Exception:
            registry = None

        if tool_name == "get_host_info":
            h = self.db.get_host(host_id)
            if not h:
                return {"error": f"主机 {host_id} 不存在"}
            if registry:
                conn = registry.get(ResourceType.HOST, host_id)
                if conn:
                    try:
                        return conn.get_system_info().model_dump()
                    except Exception as e:
                        return {"error": f"获取主机系统信息失败: {e}"}
            return {
                "host_id": h["id"],
                "name": h["name"],
                "hostname": h["host"],
                "port": h["port"],
                "os": h.get("os_info") or "Linux",
                "status": h.get("status") or "active",
            }
        elif tool_name == "run_host_command":
            cmd = str(args.get("command") or "")
            if not cmd:
                return {"error": "命令不能为空"}
            h = self.db.get_host(host_id)
            if not h:
                return {"error": f"主机 {host_id} 不存在"}
            
            # Load dynamic dangerous patterns from DB
            import json
            from memoria.config import DEFAULT_HOST_DANGEROUS_PATTERNS
            raw_patterns = self.db.get_setting("host_dangerous_patterns")
            dangerous_patterns = json.loads(raw_patterns) if raw_patterns else DEFAULT_HOST_DANGEROUS_PATTERNS

            # This legacy synchronous path has no channel approval loop. An
            # interactive command must stop here instead of reaching a
            # connector without a Hermes-style approval grant.
            from memoria.connectors.host.guard import (
                CommandApprovalRequired,
                CommandGuard,
                CommandSafetyViolation,
            )
            sec_mode = h.get("security_mode") or (
                "read_only" if h.get("safe_mode") else "ask_confirmation"
            )
            guard = CommandGuard(security_mode=sec_mode, dangerous_patterns=dangerous_patterns)
            try:
                guard.validate_command(cmd)
            except CommandSafetyViolation as exc:
                return {"status": "rejected", "error": str(exc), "host_id": host_id, "command": cmd}
            except CommandApprovalRequired as exc:
                return {"status": "pending_approval", "error": str(exc), "host_id": host_id, "command": cmd}

            if registry:
                conn = registry.get(ResourceType.HOST, host_id)
                if conn:
                    try:
                        if hasattr(conn, "guard"):
                            conn.guard.dangerous_patterns = dangerous_patterns
                            conn.guard.validate_command(cmd)
                        return conn.execute_command(cmd, approved=False).model_dump()
                    except Exception as e:
                        return {"error": f"执行主机命令失败: {e}"}
            try:
                from memoria.connectors.host.connector import HostConnector
                from memoria.connectors.host.models import HostConfig
                conn = HostConnector(HostConfig(**h), dangerous_patterns=dangerous_patterns)
                return conn.execute_command(cmd, approved=False).model_dump()
            except Exception as e:
                return {"error": f"执行主机命令异常: {e}"}
        else:
            return {"error": f"未知工具: {tool_name}"}

    def prepare_query(self, bot_id: str, query: str, session_id: str | None = None) -> dict:
        if not query or not query.strip():
            raise ValueError("Query must not be empty")
        bot = self.db.get_bot(bot_id)
        if bot is None:
            raise ValueError(f"Bot {bot_id} not found")

        logger.debug("[RAG] bot=%s query=%r kb_ids=%s top_k=%d min_score=%.3f",
                     bot_id, query, bot["kb_ids"], self._top_k, self._min_score)

        # Retrieve from all associated KBs and merge
        all_chunks: list[dict] = []
        for kb_id in bot["kb_ids"]:
            kb_chunks = self.retrieve(kb_id, query)
            logger.debug("[RAG] kb=%s retrieved %d chunks", kb_id, len(kb_chunks))
            for i, c in enumerate(kb_chunks):
                logger.debug("[RAG]   kb=%s rank=%d score=%.4f doc_id=%s text=%r",
                             kb_id, i, c["score"], c["doc_id"], c["text"][:120])
            all_chunks.extend(kb_chunks)

        all_chunks.sort(key=lambda x: x["score"], reverse=True)
        context_chunks = [c for c in all_chunks[:self._top_k] if c["score"] >= self._min_score]

        logger.debug("[RAG] after filter: %d/%d chunks passed min_score=%.3f",
                     len(context_chunks), len(all_chunks), self._min_score)
        for i, c in enumerate(context_chunks):
            logger.debug("[RAG]   injected rank=%d score=%.4f doc_id=%s text=%r",
                         i, c["score"], c["doc_id"], c["text"][:120])
        if not context_chunks:
            logger.debug("[RAG] no chunks injected — LLM will answer without context")

        # Session handling
        if session_id is not None:
            sess = self.db.get_bot_session(session_id, bot_id)
            if sess is None:
                raise ValueError(f"session {session_id} not found for bot {bot_id}")
        else:
            sess = self.db.create_session(bot_id, query)
            session_id = sess["id"]

        history = self.db.get_messages(session_id, limit=10)
        logger.debug("[RAG] session=%s history_msgs=%d", session_id, len(history))

        # Check bound hosts if any
        host_context_parts: list[str] = []
        bound_host_ids = bot.get("host_ids") or []
        if bound_host_ids:
            try:
                from memoria.server.deps import get_registry
                from memoria.connectors.base import ResourceType
                registry = get_registry()
                for hid in bound_host_ids:
                    h_info = self.db.get_host(hid)
                    if not h_info:
                        continue
                    conn = registry.get(ResourceType.HOST, hid)
                    if conn:
                        status_str = "在线" if h_info.get("status") == "active" else "离线/未检测"
                        sys_desc = f"- 主机名称: {h_info['name']} (IP: {h_info['host']}:{h_info['port']}, 用户: {h_info['username']}, 状态: {status_str}, ID: {h_info['id']})"
                        if h_info.get("os_info"):
                            sys_desc += f", 系统: {h_info['os_info']}"
                        if h_info.get("description"):
                            sys_desc += f", 说明: {h_info['description']}"
                        host_context_parts.append(sys_desc)
            except Exception as e:
                logger.warning("[RAG] failed to build host context: %s", e)

        tools_schema = self._build_host_tools_schema(bound_host_ids)

        # Build prompt
        context_text = "\n\n".join(c["text"] for c in context_chunks)
        system_content = bot["system_prompt"] or self._default_system_prompt
        
        if host_context_parts:
            host_text = "\n".join(host_context_parts)
            system_content += f"\n\n关联主机信息：\n当前助手已关联以下服务器/主机节点，当用户询问服务器状态、运行指标或需要执行排查命令时，请调用相应工具（如 get_host_info / run_host_command）进行实时查询或结合这些信息作答：\n{host_text}"

        if context_text:
            system_content += f"\n\n参考资料：\n{context_text}"

        system_content += (
            "\n\n输出格式（必须遵守）：\n"
            "### 思路摘要\n"
            "- 用 2-4 条简短要点说明判断依据、检索依据或解题思路。\n"
            "- 这里只写面向用户的简要说明，不输出内部推理过程或隐藏思考链。\n"
            "### 回答\n"
            "给出最终回答。"
        )

        messages = [{"role": "system", "content": system_content}]
        messages.extend({"role": m["role"], "content": m["content"]} for m in history)
        messages.append({"role": "user", "content": query})

        logger.debug("[RAG] sending %d messages to LLM", len(messages))
        sources = self._build_sources(context_chunks)
        return {
            "query": query,
            "session_id": session_id,
            "messages": messages,
            "sources": sources,
            "bot": bot,
            "tools_schema": tools_schema,
        }

    def query(self, bot_id: str, query: str, session_id: str | None = None) -> dict:
        prepared = self.prepare_query(bot_id, query, session_id)
        messages = list(prepared["messages"])
        tools_schema = prepared.get("tools_schema")
        bot = prepared.get("bot") or {}

        max_tool_turns = 4
        turn = 0
        while turn < max_tool_turns:
            turn += 1
            result = self._llm.call(messages, tools=tools_schema if tools_schema else None)
            tool_calls = result.get("tool_calls") if isinstance(result, dict) else None
            if not tool_calls:
                answer = result.get("content", "") if isinstance(result, dict) else str(result)
                break
            
            messages.append({
                "role": "assistant",
                "content": result.get("content") or "",
                "tool_calls": tool_calls,
            })
            for tc in tool_calls:
                func_name = tc.get("function", {}).get("name", "")
                try:
                    func_args = json.loads(tc.get("function", {}).get("arguments", "{}"))
                except Exception:
                    func_args = {}
                tool_res = self._execute_host_tool(func_name, func_args, bot)
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.get("id", ""),
                    "name": func_name,
                    "content": json.dumps(tool_res, ensure_ascii=False),
                })
        else:
            result = self._llm.call(messages)
            answer = result.get("content", "") if isinstance(result, dict) else str(result)

        logger.debug("[RAG] answer=%r", answer[:200])
        self._persist_response(prepared["session_id"], prepared["query"], answer, prepared["sources"])

        return {
            "answer": answer,
            "session_id": prepared["session_id"],
            "sources": prepared.get("sources", []),
        }

    def query_stream(self, prepared: dict) -> Iterator[dict]:
        yield {
            "type": "meta",
            "session_id": prepared["session_id"],
            "sources": prepared["sources"],
        }
        tools_schema = prepared.get("tools_schema")
        bot = prepared.get("bot") or {}
        messages = list(prepared["messages"])

        if tools_schema:
            max_tool_turns = 3
            turn = 0
            while turn < max_tool_turns:
                turn += 1
                check_res = self._llm.call(messages, tools=tools_schema)
                tool_calls = check_res.get("tool_calls") if isinstance(check_res, dict) else None
                if not tool_calls:
                    break
                
                yield {"type": "status", "message": "正在调用关联主机执行排查与状态检测…"}
                messages.append({
                    "role": "assistant",
                    "content": check_res.get("content") or "",
                    "tool_calls": tool_calls,
                })
                for tc in tool_calls:
                    func_name = tc.get("function", {}).get("name", "")
                    try:
                        func_args = json.loads(tc.get("function", {}).get("arguments", "{}"))
                    except Exception:
                        func_args = {}
                    tool_res = self._execute_host_tool(func_name, func_args, bot)
                    if func_name == "run_host_command":
                        cmd = func_args.get("command", "")
                        yield {"type": "status", "message": f"主机执行命令: {cmd}"}
                    elif func_name == "get_host_info":
                        yield {"type": "status", "message": "获取主机系统负载与资源状态完成"}
                        
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc.get("id", ""),
                        "name": func_name,
                        "content": json.dumps(tool_res, ensure_ascii=False),
                    })

        yield {"type": "status", "message": "正在请求模型并流式生成…"}

        answer_parts: list[str] = []
        try:
            for delta in self._llm.call(messages, stream=True):
                if not delta:
                    continue
                answer_parts.append(delta)
                yield {"type": "delta", "delta": delta}
        except Exception as exc:  # pragma: no cover - exercised through route tests
            logger.exception("[RAG] streaming failed")
            yield {"type": "error", "detail": str(exc)}
            return

        answer = "".join(answer_parts)
        logger.debug("[RAG] streamed answer=%r", answer[:200])
        self._persist_response(prepared["session_id"], prepared["query"], answer, prepared["sources"])
        yield {
            "type": "final",
            "answer": answer,
            "session_id": prepared["session_id"],
            "sources": prepared["sources"],
        }
