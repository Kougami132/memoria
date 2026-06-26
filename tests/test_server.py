import pytest
from fastapi.testclient import TestClient

from memoria.server.app import create_app
from memoria.server.deps import get_db, get_pipeline
from memoria.storage.db import DB
from memoria.core.pipeline import Pipeline
from memoria.core.embedder import MockEmbedder
from memoria.llm.caller import MockLLMCaller


@pytest.fixture
def client(tmp_path):
    db = DB(str(tmp_path / "test.db"))

    def _get_test_db():
        return db

    def _get_test_pipeline():
        return Pipeline(db=db, embedder=MockEmbedder(), llm=MockLLMCaller(),
                        chroma_path=str(tmp_path / "chroma"))

    app = create_app()
    app.dependency_overrides[get_db] = _get_test_db
    app.dependency_overrides[get_pipeline] = _get_test_pipeline
    return TestClient(app)


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_kb_create_and_list(client):
    r = client.post("/api/knowledge-bases", json={"name": "kb1", "description": ""})
    assert r.status_code == 201
    kb_id = r.json()["id"]
    r2 = client.get("/api/knowledge-bases")
    assert any(k["id"] == kb_id for k in r2.json())


def test_kb_delete_not_found(client):
    r = client.delete("/api/knowledge-bases/nonexistent")
    assert r.status_code == 404


def test_bot_crud(client):
    kb = client.post("/api/knowledge-bases", json={"name": "kb", "description": ""}).json()
    bot = client.post("/api/bots", json={"name": "b", "system_prompt": "", "kb_ids": [kb["id"]]}).json()
    assert bot["kb_ids"] == [kb["id"]]
    r = client.put(f"/api/bots/{bot['id']}", json={"name": "b2"})
    assert r.json()["name"] == "b2"
    client.delete(f"/api/bots/{bot['id']}")
    assert client.get(f"/api/bots/{bot['id']}").status_code == 404


def test_chat(client):
    kb = client.post("/api/knowledge-bases", json={"name": "kb", "description": ""}).json()
    bot = client.post("/api/bots", json={"name": "b", "system_prompt": "helpful", "kb_ids": [kb["id"]]}).json()
    r = client.post(f"/api/chat/{bot['id']}", json={"message": "hello"})
    assert r.status_code == 200
    data = r.json()
    assert data["answer"] == "[mock response]"
    assert "session_id" in data


def test_upload_unsupported_format(client, tmp_path):
    kb = client.post("/api/knowledge-bases", json={"name": "kb", "description": ""}).json()
    f = tmp_path / "doc.pdf"
    f.write_bytes(b"data")
    with open(f, "rb") as fh:
        r = client.post(f"/api/knowledge-bases/{kb['id']}/documents",
                        files={"file": ("doc.pdf", fh, "application/pdf")})
    assert r.status_code == 422
