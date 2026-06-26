import pytest
from memoria.core.chunker import Chunker
from memoria.core.embedder import MockEmbedder


def test_chunker_md(tmp_path):
    f = tmp_path / "doc.md"
    f.write_text("# Title\n\n" + "word " * 300)
    chunks = Chunker(chunk_size=100, chunk_overlap=20).split(str(f))
    assert len(chunks) >= 2
    assert all(isinstance(c, str) and len(c) > 0 for c in chunks)


def test_chunker_txt(tmp_path):
    f = tmp_path / "doc.txt"
    f.write_text("hello " * 200)
    chunks = Chunker().split(str(f))
    assert len(chunks) >= 1


def test_chunker_unsupported(tmp_path):
    f = tmp_path / "doc.pdf"
    f.write_text("data")
    with pytest.raises(ValueError, match="Unsupported"):
        Chunker().split(str(f))


def test_chunker_missing_file():
    with pytest.raises(FileNotFoundError):
        Chunker().split("/nonexistent/file.md")


def test_mock_embedder():
    embs = MockEmbedder().embed(["hello", "world"])
    assert len(embs) == 2
    assert len(embs[0]) == 1536
    assert all(isinstance(v, float) for v in embs[0])
