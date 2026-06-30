import chromadb
from memoria.storage.base import VectorStore


class ChromaStore(VectorStore):
    def __init__(self, path: str, collection_name: str) -> None:
        self._client = chromadb.PersistentClient(path=path)
        self._collection_name = collection_name
        # Use cosine for new collections; existing L2 collections are handled in query()
        meta = {"hnsw:space": "cosine"}
        existing = [c.name for c in self._client.list_collections()]
        self._is_cosine = collection_name not in existing
        # Create collection if not exists, detect metric
        col = self._client.get_or_create_collection(
            collection_name,
            metadata=meta if self._is_cosine else None,
        )
        stored_meta = col.metadata or {}
        self._metric = stored_meta.get("hnsw:space", "l2")

    def _col(self):
        # 每次操作重新获取 collection，兼容 Chroma 1.x
        return self._client.get_or_create_collection(
            self._collection_name,
            metadata={"hnsw:space": "cosine"} if self._is_cosine else None,
        )

    def add(self, ids: list[str], embeddings: list[list[float]],
            documents: list[str], metadatas: list[dict] | None = None) -> None:
        self._col().add(ids=ids, embeddings=embeddings, documents=documents,
                      metadatas=metadatas or [{} for _ in ids])

    def query(self, embedding: list[float], k: int = 5) -> list[dict]:
        col = self._col()
        count = col.count()
        if count == 0:
            return []
        k = min(k, count)
        res = col.query(query_embeddings=[embedding], n_results=k,
                              include=["documents", "distances", "metadatas"])
        results = []
        for text, dist, meta in zip(
            res["documents"][0], res["distances"][0], res["metadatas"][0]
        ):
            if self._metric == "cosine":
                score = 1.0 - dist
            else:
                score = 1.0 - dist / 2.0
            results.append({
                "text": text,
                "score": score,
                "doc_id": meta.get("doc_id", ""),
                "db_doc_id": meta.get("db_doc_id", ""),
            })
        return results

    def delete(self, where: dict) -> None:
        self._col().delete(where=where)
