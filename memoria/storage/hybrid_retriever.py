from __future__ import annotations

import math
import threading
from typing import Any

import jieba
from rank_bm25 import BM25Okapi


def tokenize(text: str) -> list[str]:
    """Tokenize text using jieba cut_for_search, lowercasing and stripping tokens."""
    if not text:
        return []
    return [t.lower() for t in jieba.cut_for_search(text) if t.strip()]


tokenize_cn_en = tokenize


class RobustBM25Okapi(BM25Okapi):
    def _calc_idf(self, nd):
        for word, freq in nd.items():
            idf = math.log((self.corpus_size - freq + 0.5) / (freq + 0.5) + 1.0)
            self.idf[word] = idf if idf > 0 else 0.1


class BM25Index:
    def __init__(self, documents: list[dict] | None = None) -> None:
        self._lock = threading.Lock()
        self.doc_items: list[dict] = []
        self.bm25: BM25Okapi | None = None
        if documents:
            self.build(documents)

    @property
    def documents(self) -> list[dict]:
        with self._lock:
            return list(self.doc_items)

    def build(self, documents: list[dict]) -> None:
        """
        Build BM25 index from a list of dicts.
        Each dict must have at least: 'id', 'text', and optionally 'doc_id', 'db_doc_id'.
        """
        with self._lock:
            self.doc_items = [dict(d) for d in documents]
            if not self.doc_items:
                self.bm25 = None
                return
            corpus = [tokenize(d.get("text", "")) for d in self.doc_items]
            self.bm25 = RobustBM25Okapi(corpus)

    def add_documents(self, documents: list[dict]) -> None:
        with self._lock:
            existing_ids = {d.get("id") for d in self.doc_items if d.get("id")}
            for doc in documents:
                if doc.get("id") in existing_ids:
                    self.doc_items = [d for d in self.doc_items if d.get("id") != doc.get("id")]
                self.doc_items.append(dict(doc))
            if not self.doc_items:
                self.bm25 = None
                return
            corpus = [tokenize(d.get("text", "")) for d in self.doc_items]
            self.bm25 = RobustBM25Okapi(corpus)

    def delete(self, where: dict) -> None:
        with self._lock:
            doc_id = where.get("doc_id")
            db_doc_id = where.get("db_doc_id")
            chunk_id = where.get("id")
            if not any([doc_id, db_doc_id, chunk_id]):
                return
            self.doc_items = [
                d for d in self.doc_items
                if not (
                    (doc_id and d.get("doc_id") == doc_id) or
                    (db_doc_id and d.get("db_doc_id") == db_doc_id) or
                    (chunk_id and d.get("id") == chunk_id)
                )
            ]
            if not self.doc_items:
                self.bm25 = None
                return
            corpus = [tokenize(d.get("text", "")) for d in self.doc_items]
            self.bm25 = RobustBM25Okapi(corpus)

    def delete_documents(self, where: dict) -> None:
        self.delete(where)

    def search(self, query: str, top_k: int = 10) -> list[dict]:
        with self._lock:
            if not self.bm25 or not self.doc_items:
                return []
            q_tokens = tokenize(query)
            if not q_tokens:
                return []
            scores = self.bm25.get_scores(q_tokens)
            # Pair scores with docs
            scored_docs = []
            for score, doc in zip(scores, self.doc_items):
                if score > 0:
                    scored_docs.append({
                        "id": doc.get("id"),
                        "text": doc.get("text", ""),
                        "score": float(score),
                        "doc_id": doc.get("doc_id", ""),
                        "db_doc_id": doc.get("db_doc_id", ""),
                    })
            scored_docs.sort(key=lambda x: x["score"], reverse=True)
            return scored_docs[:top_k]


class HybridRetriever:
    """
    Combines dense vector retrieval (ChromaStore) and sparse keyword retrieval (BM25Index)
    using Reciprocal Rank Fusion (RRF).
    """

    def __init__(
        self,
        vector_store: Any,
        bm25_index: BM25Index,
        rrf_k: int = 60,
        min_score: float = 0.0,
    ) -> None:
        self.vector_store = vector_store
        self.bm25_index = bm25_index
        self.rrf_k = rrf_k
        self.min_score = min_score

    def retrieve(
        self,
        query: str,
        query_embedding: list[float],
        top_k: int = 5,
        candidate_k: int = 10,
    ) -> list[dict]:
        if not query or not query.strip():
            return []

        # 1. Vector recall
        vector_candidates = self.vector_store.query(query_embedding, k=candidate_k)

        # 2. BM25 recall
        bm25_candidates = self.bm25_index.search(query, top_k=candidate_k)

        # 3. Reciprocal Rank Fusion (RRF)
        # RRF formula: RRF_score(d) = sum_{m in models} 1 / (k + rank_{m}(d))
        rrf_scores: dict[str, float] = {}
        item_map: dict[str, dict] = {}

        # Vector results ranking (rank starts at 1)
        for rank, item in enumerate(vector_candidates, start=1):
            cid = item.get("id") or item.get("text")
            if not cid:
                continue
            item_map[cid] = item
            rrf_scores[cid] = rrf_scores.get(cid, 0.0) + 1.0 / (self.rrf_k + rank)

        # BM25 results ranking (rank starts at 1)
        for rank, item in enumerate(bm25_candidates, start=1):
            cid = item.get("id") or item.get("text")
            if not cid:
                continue
            if cid not in item_map:
                item_map[cid] = item
            rrf_scores[cid] = rrf_scores.get(cid, 0.0) + 1.0 / (self.rrf_k + rank)

        if not rrf_scores:
            return []

        sorted_cids = sorted(rrf_scores.keys(), key=lambda c: rrf_scores[c], reverse=True)

        results: list[dict] = []
        for cid in sorted_cids:
            score = rrf_scores[cid]
            item = dict(item_map[cid])
            # Retain original vector score if available for min_score threshold filtering,
            # and attach rrf_score
            item["rrf_score"] = score
            if "score" not in item:
                item["score"] = score
            results.append(item)
            if len(results) >= top_k:
                break

        return results
