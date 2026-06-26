import os

from langchain_text_splitters import RecursiveCharacterTextSplitter

from memoria.config import settings

SUPPORTED = {".md", ".txt"}


class Chunker:
    def __init__(self, chunk_size: int | None = None, chunk_overlap: int | None = None) -> None:
        self._splitter = RecursiveCharacterTextSplitter(
            chunk_size=chunk_size or settings.chunk_size,
            chunk_overlap=chunk_overlap or settings.chunk_overlap,
        )

    def split(self, path: str) -> list[str]:
        ext = os.path.splitext(path)[1].lower()
        if ext not in SUPPORTED:
            raise ValueError(f"Unsupported file format: {ext}. Supported: {SUPPORTED}")
        if not os.path.exists(path):
            raise FileNotFoundError(f"File not found: {path}")
        with open(path, encoding="utf-8") as f:
            text = f.read()
        return self._splitter.split_text(text)
