from memoria.storage.base import VectorStore


class ChromaStore(VectorStore):
    def __init__(self, path: str, collection_name: str) -> None:
        raise NotImplementedError

    def add(self, ids: list[str], embeddings: list[list[float]], documents: list[str]) -> None:
        raise NotImplementedError

    def query(self, embedding: list[float], k: int = 5) -> list[dict]:
        raise NotImplementedError

    def delete(self, ids: list[str]) -> None:
        raise NotImplementedError
