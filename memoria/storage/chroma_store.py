import chromadb
from memoria.storage.base import VectorStore


class ChromaStore(VectorStore):
    def __init__(self, path: str, collection_name: str) -> None:
        self._client = chromadb.PersistentClient(path=path)
        self._col = self._client.get_or_create_collection(collection_name)

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
        return [
            {"text": text, "score": 1 - dist, "doc_id": meta.get("doc_id", "")}
            for text, dist, meta in zip(
                res["documents"][0], res["distances"][0], res["metadatas"][0]
            )
        ]

    def delete(self, where: dict) -> None:
        self._col.delete(where=where)
