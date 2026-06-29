from __future__ import annotations

import logging
import os

from memoria.core.chunker import Chunker
from memoria.core.embedder import Embedder, MockEmbedder
from memoria.llm.caller import LLMCaller, MockLLMCaller
from memoria.storage.chroma_store import ChromaStore
from memoria.storage.db import DB

logger = logging.getLogger(__name__)


class Pipeline:
    def __init__(self, db: DB, embedder: Embedder | MockEmbedder,
                 llm: LLMCaller | MockLLMCaller, chroma_path: str,
                 top_k: int = 5, min_score: float = 0.5) -> None:
        self.db = db
        self._embedder = embedder
        self._llm = llm
        self._chroma_path = chroma_path
        self._top_k = top_k
        self._min_score = min_score
        self._stores: dict[str, ChromaStore] = {}

    def _get_store(self, kb_id: str) -> ChromaStore:
        if kb_id not in self._stores:
            self._stores[kb_id] = ChromaStore(
                path=self._chroma_path,
                collection_name=f"kb_{kb_id}",
            )
        return self._stores[kb_id]

    def ingest(self, kb_id: str, path: str, source: str = "upload") -> dict:
        chunks = [c for c in Chunker().split(path) if c.strip()]
        if not chunks:
            raise ValueError("File produced no embeddable content")
        doc_id = os.path.basename(path).replace(".", "_") + "_" + kb_id[:8]
        vectors = self._embedder.embed(chunks)
        ids = [f"{doc_id}__{i}" for i in range(len(chunks))]
        metadatas = [{"doc_id": doc_id} for _ in chunks]
        self._get_store(kb_id).add(ids, vectors, chunks, metadatas)
        doc = self.db.create_doc(kb_id, os.path.basename(path), path, len(chunks), source=source)
        return {"doc_id": doc_id, "chunk_count": len(chunks), "doc": doc}

    def retrieve(self, kb_id: str, query: str, k: int | None = None) -> list[dict]:
        if not query or not query.strip():
            return []
        embedding = self._embedder.embed([query])[0]
        return self._get_store(kb_id).query(embedding, k=k or self._top_k)

    def query(self, bot_id: str, query: str, session_id: str | None = None) -> dict:
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
            sess = self.db.create_session(bot_id)
            session_id = sess["id"]

        history = self.db.get_messages(session_id, limit=10)
        logger.debug("[RAG] session=%s history_msgs=%d", session_id, len(history))

        # Build prompt
        context_text = "\n\n".join(c["text"] for c in context_chunks)
        system_content = bot["system_prompt"]
        if context_text:
            system_content += f"\n\n参考资料：\n{context_text}"

        messages = [{"role": "system", "content": system_content}]
        messages.extend({"role": m["role"], "content": m["content"]} for m in history)
        messages.append({"role": "user", "content": query})

        logger.debug("[RAG] sending %d messages to LLM", len(messages))
        result = self._llm.call(messages)
        answer = result["content"]
        logger.debug("[RAG] answer=%r", answer[:200])

        self.db.add_message(session_id, "user", query)
        self.db.add_message(session_id, "assistant", answer, sources=[
            {"text": c["text"], "score": c["score"], "doc_id": c["doc_id"]}
            for c in context_chunks
        ])

        return {
            "answer": answer,
            "session_id": session_id,
            "sources": [
                {"text": c["text"], "score": c["score"], "doc_id": c["doc_id"]}
                for c in context_chunks
            ],
        }
