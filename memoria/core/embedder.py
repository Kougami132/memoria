class Embedder:
    def __init__(self, model: str) -> None:
        raise NotImplementedError

    def embed(self, texts: list[str]) -> list[list[float]]:
        raise NotImplementedError
