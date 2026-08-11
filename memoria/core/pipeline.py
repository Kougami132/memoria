from __future__ import annotations

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
            sess = self.db.get_session(session_id)
            if sess is None:
                raise ValueError(f"session {session_id} not found")
        else:
            sess = self.db.create_session(bot_id, query)
            session_id = sess["id"]

        history = self.db.get_messages(session_id, limit=10)
        logger.debug("[RAG] session=%s history_msgs=%d", session_id, len(history))

        # Build prompt
        context_text = "\n\n".join(c["text"] for c in context_chunks)
        system_content = bot["system_prompt"] or self._default_system_prompt
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
        }

    def query(self, bot_id: str, query: str, session_id: str | None = None) -> dict:
        prepared = self.prepare_query(bot_id, query, session_id)
        result = self._llm.call(prepared["messages"])
        answer = result["content"]
        logger.debug("[RAG] answer=%r", answer[:200])
        self._persist_response(prepared["session_id"], prepared["query"], answer, prepared["sources"])

        return {
            "answer": answer,
            "session_id": prepared["session_id"],
            "sources": prepared["sources"],
        }

    def query_stream(self, prepared: dict) -> Iterator[dict]:
        yield {
            "type": "meta",
            "session_id": prepared["session_id"],
            "sources": prepared["sources"],
        }
        yield {"type": "status", "message": "正在请求模型并流式生成…"}

        answer_parts: list[str] = []
        try:
            for delta in self._llm.call(prepared["messages"], stream=True):
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
