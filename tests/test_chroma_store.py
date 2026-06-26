import pytest
from memoria.storage.chroma_store import ChromaStore


@pytest.fixture
def store(tmp_path):
    return ChromaStore(str(tmp_path / "chroma"), "test_col")


def test_add_and_query(store):
    emb = [0.1] * 1536
    store.add(["id1"], [emb], ["hello world"], [{"doc_id": "doc1"}])
    results = store.query(emb, k=1)
    assert len(results) == 1
    assert results[0]["text"] == "hello world"
    assert "score" in results[0]
    assert results[0]["doc_id"] == "doc1"


def test_empty_query(store):
    emb = [0.1] * 1536
    results = store.query(emb, k=5)
    assert results == []


def test_delete(store):
    emb = [0.1] * 1536
    store.add(["id1"], [emb], ["to delete"], [{"doc_id": "doc1"}])
    store.delete(where={"doc_id": "doc1"})
    results = store.query(emb, k=5)
    assert len(results) == 0
