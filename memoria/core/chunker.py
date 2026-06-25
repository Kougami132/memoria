class Chunker:
    def __init__(self, chunk_size: int = 512, chunk_overlap: int = 128) -> None:
        raise NotImplementedError

    def split(self, text: str) -> list[str]:
        raise NotImplementedError
