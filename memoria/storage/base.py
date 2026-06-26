from abc import ABC, abstractmethod


class VectorStore(ABC):
    @abstractmethod
    def add(self, ids: list[str], embeddings: list[list[float]], documents: list[str]) -> None:
        raise NotImplementedError

    @abstractmethod
    def query(self, embedding: list[float], k: int = 5) -> list[dict]:
        raise NotImplementedError

    @abstractmethod
    def delete(self, where: dict) -> None:
        raise NotImplementedError
