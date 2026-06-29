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
                        chroma_path=str(tmp_path / "chroma"), top_k=5)

    app = create_app(lifespan=None)
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


def test_settings_get(client):
    r = client.get("/api/settings")
    assert r.status_code == 200
    data = r.json()
    assert "openai_base_url" in data
    assert "openai_api_key" in data
    assert "top_k" in data


def test_settings_put(client):
    r = client.put("/api/settings", json={"top_k": 8, "llm_model": "gpt-4o"})
    assert r.status_code == 200
    data = r.json()
    assert data["top_k"] == "8"
    assert data["llm_model"] == "gpt-4o"


def test_settings_put_skip_empty_api_key(client):
    from memoria.config import settings
    r = client.put("/api/settings", json={"top_k": 3, "api_key": None})
    assert r.status_code == 200
    assert client.get("/api/settings").json()["openai_api_key"] == settings.openai_api_key


def test_bot_sessions(client):
    kb = client.post("/api/knowledge-bases", json={"name": "kb", "description": ""}).json()
    bot = client.post("/api/bots", json={"name": "b", "system_prompt": "", "kb_ids": [kb["id"]]}).json()
    r = client.post(f"/api/chat/{bot['id']}", json={"message": "hello"})
    assert r.status_code == 200
    r2 = client.get(f"/api/bots/{bot['id']}/sessions")
    assert r2.status_code == 200
    assert len(r2.json()) == 1


def test_bot_sessions_not_found(client):
    r = client.get("/api/bots/nonexistent/sessions")
    assert r.status_code == 404


def test_session_messages(client):
    kb = client.post("/api/knowledge-bases", json={"name": "kb", "description": ""}).json()
    bot = client.post("/api/bots", json={"name": "b", "system_prompt": "", "kb_ids": [kb["id"]]}).json()
    r = client.post(f"/api/chat/{bot['id']}", json={"message": "hello"})
    session_id = r.json()["session_id"]
    r2 = client.get(f"/api/sessions/{session_id}/messages")
    assert r2.status_code == 200
    msgs = r2.json()
    assert len(msgs) == 2
    assert msgs[0]["role"] == "user"


def test_session_messages_not_found(client):
    r = client.get("/api/sessions/nonexistent/messages")
    assert r.status_code == 404


def test_chat_has_sources(client):
    kb = client.post("/api/knowledge-bases", json={"name": "kb", "description": ""}).json()
    bot = client.post("/api/bots", json={"name": "b", "system_prompt": "", "kb_ids": [kb["id"]]}).json()
    r = client.post(f"/api/chat/{bot['id']}", json={"message": "hello"})
    assert r.status_code == 200
    data = r.json()
    assert "sources" in data
    assert isinstance(data["sources"], list)


# ── Vault API tests ───────────────────────────────────────────────────────────

def test_vault_bind_local(client):
    kb = client.post("/api/knowledge-bases", json={"name": "kb1", "description": ""}).json()
    r = client.post(f"/api/knowledge-bases/{kb['id']}/vault",
                    json={"type": "local", "local_path": "/tmp/vault"})
    assert r.status_code == 201
    data = r.json()
    assert data["type"] == "local"
    assert data["local_path"] == "/tmp/vault"
    assert "webdav_password" not in data


def test_vault_get(client):
    kb = client.post("/api/knowledge-bases", json={"name": "kb1", "description": ""}).json()
    client.post(f"/api/knowledge-bases/{kb['id']}/vault",
                json={"type": "local", "local_path": "/tmp/vault"})
    r = client.get(f"/api/knowledge-bases/{kb['id']}/vault")
    assert r.status_code == 200
    assert r.json()["type"] == "local"


def test_vault_get_not_found(client):
    kb = client.post("/api/knowledge-bases", json={"name": "kb1", "description": ""}).json()
    r = client.get(f"/api/knowledge-bases/{kb['id']}/vault")
    assert r.status_code == 404


def test_vault_duplicate_bind_409(client):
    kb = client.post("/api/knowledge-bases", json={"name": "kb1", "description": ""}).json()
    client.post(f"/api/knowledge-bases/{kb['id']}/vault",
                json={"type": "local", "local_path": "/tmp/vault"})
    r = client.post(f"/api/knowledge-bases/{kb['id']}/vault",
                    json={"type": "local", "local_path": "/tmp/vault2"})
    assert r.status_code == 409


def test_vault_delete_unbind(client):
    kb = client.post("/api/knowledge-bases", json={"name": "kb1", "description": ""}).json()
    client.post(f"/api/knowledge-bases/{kb['id']}/vault",
                json={"type": "local", "local_path": "/tmp/vault"})
    r = client.delete(f"/api/knowledge-bases/{kb['id']}/vault")
    assert r.status_code == 204
    r2 = client.get(f"/api/knowledge-bases/{kb['id']}/vault")
    assert r2.status_code == 404


def test_vault_delete_not_found(client):
    kb = client.post("/api/knowledge-bases", json={"name": "kb1", "description": ""}).json()
    r = client.delete(f"/api/knowledge-bases/{kb['id']}/vault")
    assert r.status_code == 404


def test_vault_sync_returns_202(client):
    kb = client.post("/api/knowledge-bases", json={"name": "kb1", "description": ""}).json()
    client.post(f"/api/knowledge-bases/{kb['id']}/vault",
                json={"type": "local", "local_path": "/tmp/vault"})
    r = client.post(f"/api/knowledge-bases/{kb['id']}/vault/sync")
    assert r.status_code == 202


def test_vault_sync_no_vault_404(client):
    kb = client.post("/api/knowledge-bases", json={"name": "kb1", "description": ""}).json()
    r = client.post(f"/api/knowledge-bases/{kb['id']}/vault/sync")
    assert r.status_code == 404


def test_vault_doc_delete_409(client, tmp_path):
    """Vault-sourced documents must not be manually deletable (409)."""
    from memoria.storage.db import DB
    # Need direct DB access to create a vault-sourced doc
    # Use the client's overridden db
    kb = client.post("/api/knowledge-bases", json={"name": "kb1", "description": ""}).json()
    # Upload a normal doc first to verify upload still works
    f = tmp_path / "note.md"
    f.write_text("# Hello")
    with open(f, "rb") as fh:
        r = client.post(f"/api/knowledge-bases/{kb['id']}/documents",
                        files={"file": ("note.md", fh, "text/plain")})
    assert r.status_code == 201

    # Manually patch the doc source to vault in the DB
    # We can use the GET endpoint to get the doc id, then directly call db
    docs = client.get(f"/api/knowledge-bases/{kb['id']}/documents").json()
    doc_id = docs[0]["id"]

    # Can delete upload-sourced doc
    r_del = client.delete(f"/api/documents/{doc_id}")
    assert r_del.status_code == 204
