import pytest

from memoria.core.embedder import MockEmbedder
from memoria.core.pipeline import Pipeline
from memoria.llm.caller import MockLLMCaller
from memoria.storage.db import DB


@pytest.fixture
def pipeline(tmp_path):
    db = DB(str(tmp_path / "test.db"))
    return Pipeline(
        db=db,
        embedder=MockEmbedder(),
        llm=MockLLMCaller(),
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


def test_query_single_turn(pipeline, tmp_path):
    f = tmp_path / "doc.md"
    f.write_text("content " * 100)
    kb = pipeline.db.create_kb("kb1", "")
    pipeline.ingest(kb["id"], str(f))
    bot = pipeline.db.create_bot("bot1", "helpful", [kb["id"]])
    result = pipeline.query(bot["id"], "question?")
    assert result["answer"] == "[mock response]"
    assert result["session_id"] is not None


def test_query_multi_turn(pipeline, tmp_path):
    f = tmp_path / "doc.md"
    f.write_text("content " * 100)
    kb = pipeline.db.create_kb("kb1", "")
    pipeline.ingest(kb["id"], str(f))
    bot = pipeline.db.create_bot("bot1", "helpful", [kb["id"]])
    r1 = pipeline.query(bot["id"], "first question")
    r2 = pipeline.query(bot["id"], "second question", session_id=r1["session_id"])
    assert r2["session_id"] == r1["session_id"]
    msgs = pipeline.db.get_messages(r1["session_id"], limit=20)
    assert len(msgs) == 4


def test_query_invalid_session(pipeline):
    bot = pipeline.db.create_bot("bot1", "helpful", [])
    with pytest.raises(ValueError):
        pipeline.query(bot["id"], "question", session_id="nonexistent-session-id")


def test_ingest_chroma_metadata_contains_db_doc_id(pipeline, tmp_path):
    f = tmp_path / "doc.md"
    f.write_text("content " * 100)
    kb = pipeline.db.create_kb("kb1", "")
    result = pipeline.ingest(kb["id"], str(f))
    db_doc_id = result["doc"]["id"]
    store = pipeline._get_store(kb["id"])
    # Fetch all stored metadatas and verify db_doc_id is present
    raw = store._col().get(include=["metadatas"])
    assert all(m.get("db_doc_id") == db_doc_id for m in raw["metadatas"])


def test_ingest_tmp_path_used_for_chunking(pipeline, tmp_path):
    # logical path does not exist; tmp_path points to the real content
    real = tmp_path / "real.md"
    real.write_text("content " * 100)
    kb = pipeline.db.create_kb("kb1", "")
    logical = "/vault/some/logical/path.md"
    result = pipeline.ingest(kb["id"], logical, filename="real.md", tmp_path=str(real))
    assert result["chunk_count"] > 0
    doc = result["doc"]
    assert doc["path"] == logical
    assert doc["filename"] == "real.md"


def test_query_source_contains_filename_path_source(pipeline, tmp_path):
    f = tmp_path / "notes.md"
    f.write_text("content " * 100)
    kb = pipeline.db.create_kb("kb1", "")
    pipeline.ingest(kb["id"], str(f), source="vault", filename="notes.md")
    bot = pipeline.db.create_bot("bot1", "helpful", [kb["id"]])
    result = pipeline.query(bot["id"], "content")
    assert len(result["sources"]) > 0
    src = result["sources"][0]
    assert src["filename"] == "notes.md"
    assert src["path"] == str(f)
    assert src["source"] == "vault"


def test_query_source_degrades_gracefully_without_db_doc_id(pipeline, tmp_path):
    f = tmp_path / "doc.md"
    f.write_text("content " * 100)
    kb = pipeline.db.create_kb("kb1", "")
    # Ingest normally then manually corrupt one chunk's metadata to remove db_doc_id
    pipeline.ingest(kb["id"], str(f))
    store = pipeline._get_store(kb["id"])
    raw = store._col().get(include=["metadatas", "embeddings", "documents"])
    # Overwrite first chunk without db_doc_id
    first_id = raw["ids"][0]
    bad_meta = {k: v for k, v in raw["metadatas"][0].items() if k != "db_doc_id"}
    store._col().update(ids=[first_id], metadatas=[bad_meta])

    bot = pipeline.db.create_bot("bot1", "helpful", [kb["id"]])
    # Should not raise even if some chunks lack db_doc_id
    result = pipeline.query(bot["id"], "content")
    for src in result["sources"]:
        assert "filename" in src
        assert "path" in src
        assert "source" in src


def test_prepare_query_uses_default_system_prompt_fallback(tmp_path):
    db = DB(str(tmp_path / "test.db"))
    pipeline = Pipeline(
        db=db,
        embedder=MockEmbedder(),
        llm=MockLLMCaller(),
        chroma_path=str(tmp_path / "chroma"),
        default_system_prompt="global default",
    )
    bot = db.create_bot("bot1", "", [])

    prepared = pipeline.prepare_query(bot["id"], "hello")

    assert prepared["messages"][0]["role"] == "system"
    assert prepared["messages"][0]["content"].startswith("global default")


def test_prepare_query_prefers_bot_system_prompt(tmp_path):
    db = DB(str(tmp_path / "test.db"))
    pipeline = Pipeline(
        db=db,
        embedder=MockEmbedder(),
        llm=MockLLMCaller(),
        chroma_path=str(tmp_path / "chroma"),
        default_system_prompt="global default",
    )
    bot = db.create_bot("bot1", "bot custom prompt", [])

    prepared = pipeline.prepare_query(bot["id"], "hello")

    assert prepared["messages"][0]["role"] == "system"
    assert prepared["messages"][0]["content"].startswith("bot custom prompt")
