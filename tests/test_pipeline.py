import os
import pytest

from memoria.storage.db import DB
from memoria.core.pipeline import Pipeline
from memoria.core.embedder import MockEmbedder
from memoria.llm.caller import MockLLMCaller


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
