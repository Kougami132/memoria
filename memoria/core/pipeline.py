from __future__ import annotations

import logging
import os
import threading
from typing import TYPE_CHECKING

from memoria.core.chunker import Chunker
from memoria.core.embedder import Embedder, MockEmbedder
from memoria.storage.chroma_store import ChromaStore
from memoria.storage.db import DB
from memoria.storage.hybrid_retriever import BM25Index, HybridRetriever

if TYPE_CHECKING:
    from memoria.llm.caller import LLMCaller, MockLLMCaller

logger = logging.getLogger(__name__)


class Pipeline:
    """Core RAG ingestion and hybrid retrieval engine.

    Pipeline is responsible for parsing documents into chunks, generating vector
    embeddings, maintaining the persistent ChromaDB collection and BM25 index,
    and performing top-k hybrid search. All conversational orchestration and
    agent tool dispatching are handled exclusively by AgentEngine.
    """

    def __init__(
        self,
        db: DB,
        embedder: Embedder | MockEmbedder,
        llm: LLMCaller | MockLLMCaller | None = None,
        chroma_path: str = "",
        top_k: int = 5,
        min_score: float = 0.5,
        default_system_prompt: str = "",
    ) -> None:
        self.db = db
        self._embedder = embedder
        self._llm = llm
        self._chroma_path = chroma_path
        self._top_k = top_k
        self._min_score = min_score
        self._default_system_prompt = default_system_prompt
        self._local = threading.local()  # Thread-local ChromaStore cache
        self._bm25_indices: dict[str, BM25Index] = {}
        self._bm25_lock = threading.Lock()

    def _get_store(self, kb_id: str) -> ChromaStore:
        if not hasattr(self._local, "stores"):
            self._local.stores = {}
        if kb_id not in self._local.stores:
            self._local.stores[kb_id] = ChromaStore(
                path=self._chroma_path,
                collection_name=f"kb_{kb_id}",
            )
        return self._local.stores[kb_id]

    def _get_bm25_index(self, kb_id: str) -> BM25Index:
        with self._bm25_lock:
            if kb_id not in self._bm25_indices:
                store = self._get_store(kb_id)
                docs = store.get_all_documents()
                self._bm25_indices[kb_id] = BM25Index(docs)
            return self._bm25_indices[kb_id]

    def _invalidate_bm25(self, kb_id: str) -> None:
        if not hasattr(self, "_bm25_lock"):
            self._bm25_lock = threading.Lock()
        if not hasattr(self, "_bm25_indices"):
            self._bm25_indices = {}
        with self._bm25_lock:
            self._bm25_indices.pop(kb_id, None)

    def ingest(
        self,
        kb_id: str,
        path: str,
        source: str = "upload",
        filename: str | None = None,
        tmp_path: str | None = None,
    ) -> dict:
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
        self._invalidate_bm25(kb_id)
        return {"doc_id": doc_id, "chunk_count": len(chunks), "doc": doc}

    def delete_doc(self, doc_id: str, kb_id: str) -> None:
        """Delete a document and all vector chunks associated with it."""
        self._get_store(kb_id).delete(where={"db_doc_id": doc_id})
        self._invalidate_bm25(kb_id)
        self.db.delete_doc(doc_id)

    def retrieve(self, kb_id: str, query: str, k: int | None = None) -> list[dict]:
        """Perform dense + sparse hybrid search with Reciprocal Rank Fusion."""
        if not query or not query.strip():
            return []
        target_k = k or self._top_k
        store = self._get_store(kb_id)
        bm25_idx = self._get_bm25_index(kb_id)
        embedding = self._embedder.embed([query])[0]
        retriever = HybridRetriever(
            vector_store=store,
            bm25_index=bm25_idx,
            rrf_k=60,
            min_score=0.0,
        )
        return retriever.retrieve(query=query, query_embedding=embedding, top_k=target_k)
