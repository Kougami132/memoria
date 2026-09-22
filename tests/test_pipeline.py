import pytest

from memoria.core.embedder import MockEmbedder
from memoria.core.pipeline import Pipeline
from memoria.storage.db import DB


@pytest.fixture
def pipeline(tmp_path):
    db = DB(str(tmp_path / "test.db"))
    return Pipeline(
        db=db,
        embedder=MockEmbedder(),
        chroma_path=str(tmp_path / "chroma"),
    )


def test_ingest(pipeline, tmp_path):
    f = tmp_path / "doc.md"
    f.write_text("# Title\n\n" + "word " * 200)
    kb = pipeline.db.create_kb("kb1", "")
    result = pipeline.ingest(kb["id"], str(f))
    assert result["chunk_count"] > 0
    docs = pipeline.db.list_docs(kb["id"])
    assert len(docs) == 1
    assert docs[0]["chunk_count"] == result["chunk_count"]


def test_retrieve_empty(pipeline):
    kb = pipeline.db.create_kb("kb1", "")
    results = pipeline.retrieve(kb["id"], "some query")
    assert results == []


def test_retrieve_chunks(pipeline, tmp_path):
    f = tmp_path / "doc.md"
    f.write_text("Kubernetes cluster networking configuration and DNS policies.")
    kb = pipeline.db.create_kb("kb1", "")
    pipeline.ingest(kb["id"], str(f), filename="k8s.md")
    results = pipeline.retrieve(kb["id"], "networking", k=3)
    assert len(results) > 0
    assert "text" in results[0]
    assert "score" in results[0]


def test_delete_doc(pipeline, tmp_path):
    f = tmp_path / "doc.md"
    f.write_text("Some text for document deletion test")
    kb = pipeline.db.create_kb("kb1", "")
    res = pipeline.ingest(kb["id"], str(f))
    doc_id = res["doc"]["id"]
    assert len(pipeline.db.list_docs(kb["id"])) == 1

    pipeline.delete_doc(doc_id, kb["id"])
    assert len(pipeline.db.list_docs(kb["id"])) == 0
    results = pipeline.retrieve(kb["id"], "Some text")
    assert results == []


def test_ingest_chroma_metadata_contains_db_doc_id(pipeline, tmp_path):
    f = tmp_path / "doc.md"
    f.write_text("content " * 100)
    kb = pipeline.db.create_kb("kb1", "")
    result = pipeline.ingest(kb["id"], str(f))
    db_doc_id = result["doc"]["id"]
    store = pipeline._get_store(kb["id"])
    raw = store._col().get(include=["metadatas"])
    assert all(m.get("db_doc_id") == db_doc_id for m in raw["metadatas"])


def test_ingest_tmp_path_used_for_chunking(pipeline, tmp_path):
    real = tmp_path / "real.md"
    real.write_text("content " * 100)
    kb = pipeline.db.create_kb("kb1", "")
    logical = "/vault/some/logical/path.md"
    result = pipeline.ingest(kb["id"], logical, filename="real.md", tmp_path=str(real))
    assert result["chunk_count"] > 0
    doc = result["doc"]
    assert doc["path"] == logical
    assert doc["filename"] == "real.md"
