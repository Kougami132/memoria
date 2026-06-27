from __future__ import annotations

import os

from memoria.core.chunker import Chunker
from memoria.core.embedder import Embedder, MockEmbedder
from memoria.llm.caller import LLMCaller, MockLLMCaller
from memoria.storage.chroma_store import ChromaStore
from memoria.storage.db import DB


class Pipeline:
    def __init__(self, db: DB, embedder: Embedder | MockEmbedder,
                 llm: LLMCaller | MockLLMCaller, chroma_path: str,
                 top_k: int = 5) -> None:
        self.db = db
        self._embedder = embedder
        self._llm = llm
        self._chroma_path = chroma_path
        self._top_k = top_k
        self._stores: dict[str, ChromaStore] = {}

    def _get_store(self, kb_id: str) -> ChromaStore:
        if kb_id not in self._stores:
            self._stores[kb_id] = ChromaStore(
                path=self._chroma_path,
                collection_name=f"kb_{kb_id}",
            )
        return self._stores[kb_id]

    def ingest(self, kb_id: str, path: str) -> dict:
        chunks = Chunker().split(path)
        doc_id = os.path.basename(path).replace(".", "_") + "_" + kb_id[:8]
        vectors = self._embedder.embed(chunks)
        ids = [f"{doc_id}__{i}" for i in range(len(chunks))]
        metadatas = [{"doc_id": doc_id} for _ in chunks]
        self._get_store(kb_id).add(ids, vectors, chunks, metadatas)
        doc = self.db.create_doc(kb_id, os.path.basename(path), path, len(chunks))
        return {"doc_id": doc_id, "chunk_count": len(chunks), "doc": doc}

    def retrieve(self, kb_id: str, query: str, k: int | None = None) -> list[dict]:
        embedding = self._embedder.embed([query])[0]
        return self._get_store(kb_id).query(embedding, k=k or self._top_k)

    def query(self, bot_id: str, query: str, session_id: str | None = None) -> dict:
        bot = self.db.get_bot(bot_id)
        if bot is None:
            raise ValueError(f"Bot {bot_id} not found")

        # Retrieve from all associated KBs and merge
        all_chunks: list[dict] = []
        for kb_id in bot["kb_ids"]:
            all_chunks.extend(self.retrieve(kb_id, query))
        all_chunks.sort(key=lambda x: x["score"], reverse=True)
        context_chunks = all_chunks[:self._top_k]

        # Session handling
        if session_id is not None:
            sess = self.db.get_session(session_id)
            if sess is None:
                raise ValueError(f"session {session_id} not found")
        else:
            sess = self.db.create_session(bot_id)
            session_id = sess["id"]

        history = self.db.get_messages(session_id, limit=10)

        # Build prompt
        context_text = "\n\n".join(c["text"] for c in context_chunks)
        system_content = bot["system_prompt"]
        if context_text:
            system_content += f"\n\n参考资料：\n{context_text}"

        messages = [{"role": "system", "content": system_content}]
        messages.extend({"role": m["role"], "content": m["content"]} for m in history)
        messages.append({"role": "user", "content": query})

        result = self._llm.call(messages)
        answer = result["content"]

        self.db.add_message(session_id, "user", query)
        self.db.add_message(session_id, "assistant", answer)

        return {
            "answer": answer,
            "session_id": session_id,
            "sources": [
                {"text": c["text"], "score": c["score"], "doc_id": c["doc_id"]}
                for c in context_chunks
            ],
        }
