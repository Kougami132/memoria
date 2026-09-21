import time
import pytest
from fastapi.testclient import TestClient

from memoria.server.app import create_app
from memoria.server.deps import get_db, get_pipeline, get_task_queue
from memoria.storage.db import DB
from memoria.core.pipeline import Pipeline
from memoria.core.embedder import MockEmbedder
from memoria.llm.caller import MockLLMCaller
from memoria.tasks.queue import SqliteTaskQueue
from memoria.tasks.handlers import make_document_ingest_handler, make_vault_sync_handler


@pytest.fixture
def task_server(tmp_path):
    db = DB(str(tmp_path / "test.db"))
    pipeline = Pipeline(
        db=db,
        embedder=MockEmbedder(),
        llm=MockLLMCaller(),
        chroma_path=str(tmp_path / "chroma"),
    )
    queue = SqliteTaskQueue(db=db, poll_interval=0.05)
    queue.register_handler("document_ingest", make_document_ingest_handler(lambda: pipeline))
    queue.register_handler("vault_sync", make_vault_sync_handler(lambda: db, lambda: pipeline))

    app = create_app()
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_pipeline] = lambda: pipeline
    app.dependency_overrides[get_task_queue] = lambda: queue

    return TestClient(app), queue, db, tmp_path


def test_async_document_upload_and_poll(task_server):
    client, queue, db, tmp_path = task_server
    kb = client.post("/api/knowledge-bases", json={"name": "kb_async", "description": ""}).json()

    # Upload document with async_mode=true (default)
    f = tmp_path / "doc.txt"
    f.write_text("Async task ingestion text content " * 10)
    with open(f, "rb") as fh:
        r = client.post(
            f"/api/knowledge-bases/{kb['id']}/documents",
            files={"file": ("doc.txt", fh, "text/plain")},
        )
    assert r.status_code == 202
    data = r.json()
    assert "task_id" in data
    assert data["status"] == "pending"

    task_id = data["task_id"]

    # Poll status immediately
    r_poll = client.get(f"/api/tasks/{task_id}")
    assert r_poll.status_code == 200
    assert r_poll.json()["id"] == task_id
    assert r_poll.json()["task_type"] == "document_ingest"

    # Run queue one step
    import asyncio
    asyncio.run(queue.process_next())

    # Poll status after processing
    r_poll_done = client.get(f"/api/tasks/{task_id}")
    assert r_poll_done.status_code == 200
    res_json = r_poll_done.json()
    assert res_json["status"] == "completed"
    assert res_json["result"]["chunk_count"] > 0

    # Verify document exists in database
    docs = client.get(f"/api/knowledge-bases/{kb['id']}/documents").json()
    assert len(docs) == 1
    assert docs[0]["filename"] == "doc.txt"


def test_task_not_found(task_server):
    client, queue, db, tmp_path = task_server
    r = client.get("/api/tasks/nonexistent-id")
    assert r.status_code == 404
