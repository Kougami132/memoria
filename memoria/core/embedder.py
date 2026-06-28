import random

from openai import OpenAI


class Embedder:
    def __init__(self, base_url: str, api_key: str, model: str) -> None:
        self._client = OpenAI(base_url=base_url, api_key=api_key)
        self._model = model

    def embed(self, texts: list[str]) -> list[list[float]]:
        try:
            response = self._client.embeddings.create(input=texts, model=self._model)
        except Exception as e:
            raise RuntimeError(f"Embedding failed (base_url={self._client.base_url}): {e}") from e
        return [item.embedding for item in response.data]


class MockEmbedder:
    def embed(self, texts: list[str]) -> list[list[float]]:
        return [[random.random() for _ in range(1536)] for _ in texts]
