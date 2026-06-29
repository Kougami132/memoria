import chromadb
from memoria.storage.base import VectorStore


class ChromaStore(VectorStore):
    def __init__(self, path: str, collection_name: str) -> None:
        self._client = chromadb.PersistentClient(path=path)
        # Use cosine for new collections; existing L2 collections are handled in query()
        meta = {"hnsw:space": "cosine"}
        existing = [c.name for c in self._client.list_collections()]
        self._is_cosine = collection_name not in existing
        self._col = self._client.get_or_create_collection(
            collection_name,
            metadata=meta if self._is_cosine else None,
        )
        # Detect actual metric of existing collection
        stored_meta = self._col.metadata or {}
        self._metric = stored_meta.get("hnsw:space", "l2")

    def add(self, ids: list[str], embeddings: list[list[float]],
            documents: list[str], metadatas: list[dict] | None = None) -> None:
        self._col.add(ids=ids, embeddings=embeddings, documents=documents,
                      metadatas=metadatas or [{} for _ in ids])

    def query(self, embedding: list[float], k: int = 5) -> list[dict]:
        count = self._col.count()
        if count == 0:
            return []
        k = min(k, count)
        res = self._col.query(query_embeddings=[embedding], n_results=k,
                              include=["documents", "distances", "metadatas"])
        results = []
        for text, dist, meta in zip(
            res["documents"][0], res["distances"][0], res["metadatas"][0]
        ):
            if self._metric == "cosine":
                # Chroma cosine distance = 1 - cosine_similarity, range [0, 2]
                score = 1.0 - dist
            else:
                # Chroma L2 returns squared L2 distance for normalized vectors
                # cos_sim = 1 - squared_l2 / 2
                score = 1.0 - dist / 2.0
            results.append({"text": text, "score": score, "doc_id": meta.get("doc_id", "")})
        return results

    def delete(self, where: dict) -> None:
        self._col.delete(where=where)
