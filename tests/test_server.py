import json

import pytest
from fastapi.testclient import TestClient

from memoria.config import get_effective_settings
from memoria.core.embedder import MockEmbedder
from memoria.core.pipeline import Pipeline
from memoria.llm.caller import MockLLMCaller
from memoria.agents.engine import AgenticRagEngine
from memoria.server.app import create_app
from memoria.server.deps import get_db, get_pipeline, get_agentic_engine
from memoria.storage.db import DB


@pytest.fixture
def client(tmp_path):
    db = DB(str(tmp_path / "test.db"))

    def _get_test_db():
        return db

    def _get_test_pipeline():
        return Pipeline(db=db, embedder=MockEmbedder(), llm=MockLLMCaller(),
                        chroma_path=str(tmp_path / "chroma"), top_k=5,
                        default_system_prompt=get_effective_settings(db)["system_prompt"])

    def _get_test_engine():
        return AgenticRagEngine(db=db, pipeline=_get_test_pipeline())

    app = create_app(lifespan=None)
    app.dependency_overrides[get_db] = _get_test_db
    app.dependency_overrides[get_pipeline] = _get_test_pipeline
    app.dependency_overrides[get_agentic_engine] = _get_test_engine
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
    r = client.post("/v1/chat/completions", json={"model": bot["id"], "messages": [{"role": "user", "content": "hello"}]})
    assert r.status_code == 200
    data = r.json()
    assert "choices" in data
    assert data["choices"][0]["message"]["content"] == "[mock agentic response]" 


@pytest.mark.parametrize("model_field", ["model_key", "name", "legacy_prefixed", "id"])
def test_chat_accepts_bot_model_aliases(client, model_field):
    bot = client.post("/api/bots", json={
        "name": "中文助手",
        "model_key": "customer-support",
        "system_prompt": "",
        "kb_ids": [],
    }).json()
    model = f"bot:{bot['id']}" if model_field == "legacy_prefixed" else bot[model_field]

    response = client.post(
        "/v1/chat/completions",
        json={"model": model, "messages": [{"role": "user", "content": "hello"}]},
    )

    assert response.status_code == 200
    assert response.json()["model"] == model


def test_responses_accepts_bot_name_and_model_key(client):
    bot = client.post("/api/bots", json={
        "name": "常规对话助手",
        "model_key": "general-chat",
        "system_prompt": "",
        "kb_ids": [],
    }).json()

    for model in (bot["name"], bot["model_key"]):
        response = client.post("/v1/responses", json={"model": model, "input": "hello"})
        assert response.status_code == 200
        assert response.json()["model"] == model


@pytest.mark.parametrize("endpoint,payload", [
    ("/v1/chat/completions", {"model": "unknown-model", "messages": [{"role": "user", "content": "hello"}]}),
    ("/v1/responses", {"model": "unknown-model", "input": "hello"}),
])
def test_unknown_model_returns_404(client, endpoint, payload):
    response = client.post(endpoint, json=payload)

    assert response.status_code == 404
    assert response.json()["detail"] == "Model not found: unknown-model"


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


def test_external_api_token_authentication_and_rotation(client):
    assert client.get("/v1/models").status_code == 200

    configured = client.put("/api/settings", json={"external_api_token": "first-token"})
    assert configured.status_code == 200
    assert configured.json()["external_api_token"] == "first-token"

    for headers in ({}, {"Authorization": "Basic first-token"}, {"Authorization": "Bearer wrong-token"}, {"Authorization": "Bearer"}):
        response = client.get("/v1/models", headers=headers)
        assert response.status_code == 401
        assert response.headers["www-authenticate"] == "Bearer"
        assert response.json()["detail"] == "Invalid or missing bearer token"

    valid = client.get("/v1/models", headers={"Authorization": "Bearer first-token"})
    assert valid.status_code == 200

    rotated = client.put("/api/settings", json={"external_api_token": "second-token"})
    assert rotated.status_code == 200
    assert client.get("/v1/models", headers={"Authorization": "Bearer first-token"}).status_code == 401
    assert client.get("/v1/models", headers={"Authorization": "Bearer second-token"}).status_code == 200

    disabled = client.put("/api/settings", json={"external_api_token": ""})
    assert disabled.status_code == 200
    assert disabled.json()["external_api_token"] == ""
    assert client.get("/v1/models").status_code == 200


def test_settings_system_prompt_get_and_put(client):
    r = client.get("/api/settings")
    assert r.status_code == 200
    assert "system_prompt" in r.json()

    r = client.put("/api/settings", json={"system_prompt": "configured default"})
    assert r.status_code == 200
    assert r.json()["system_prompt"] == "configured default"
    assert client.get("/api/settings").json()["system_prompt"] == "configured default"


def test_chat_fallback_uses_updated_default_system_prompt(client):
    client.put("/api/settings", json={"system_prompt": "configured default"})
    kb = client.post("/api/knowledge-bases", json={"name": "kb", "description": ""}).json()
    bot = client.post("/api/bots", json={"name": "b", "system_prompt": "", "kb_ids": [kb["id"]]}).json()

    pipeline = client.app.dependency_overrides[get_pipeline]()
    prepared = pipeline.prepare_query(bot["id"], "hello")

    assert prepared["messages"][0]["role"] == "system"
    assert prepared["messages"][0]["content"].startswith("configured default")


def test_chat_keeps_bot_system_prompt_over_global_default(client):
    client.put("/api/settings", json={"system_prompt": "configured default"})
    kb = client.post("/api/knowledge-bases", json={"name": "kb", "description": ""}).json()
    bot = client.post("/api/bots", json={"name": "b", "system_prompt": "bot custom", "kb_ids": [kb["id"]]}).json()

    pipeline = client.app.dependency_overrides[get_pipeline]()
    prepared = pipeline.prepare_query(bot["id"], "hello")

    assert prepared["messages"][0]["role"] == "system"
    assert prepared["messages"][0]["content"].startswith("bot custom")


def test_settings_put_skip_empty_api_key(client):
    from memoria.config import settings
    r = client.put("/api/settings", json={"top_k": 3, "api_key": None})
    assert r.status_code == 200
    assert client.get("/api/settings").json()["openai_api_key"] == settings.openai_api_key


def test_bot_sessions(client):
    kb = client.post("/api/knowledge-bases", json={"name": "kb", "description": ""}).json()
    bot = client.post("/api/bots", json={"name": "b", "system_prompt": "", "kb_ids": [kb["id"]]}).json()
    r = client.post("/v1/responses", json={"model": f"bot:{bot['id']}", "input": "hello"})
    assert r.status_code == 200
    r2 = client.get(f"/api/bots/{bot['id']}/sessions")
    assert r2.status_code == 200
    sessions = r2.json()
    assert len(sessions) == 1
    assert sessions[0]["title"] == "hello"


def test_update_session_title(client):
    kb = client.post("/api/knowledge-bases", json={"name": "kb", "description": ""}).json()
    bot = client.post("/api/bots", json={"name": "b", "system_prompt": "", "kb_ids": [kb["id"]]}).json()
    chat = client.post("/v1/responses", json={"model": f"bot:{bot['id']}", "input": "请解释 Memoria 的会话标题"}).json()

    r = client.patch(f"/api/sessions/{chat['session_id']}", json={"title": "我的自定义标题"})

    assert r.status_code == 200
    assert r.json()["title"] == "我的自定义标题"
    sessions = client.get(f"/api/bots/{bot['id']}/sessions").json()
    assert sessions[0]["title"] == "我的自定义标题"


def test_update_session_title_not_found(client):
    r = client.patch("/api/sessions/nonexistent", json={"title": "不存在"})
    assert r.status_code == 404


def test_bot_sessions_not_found(client):
    r = client.get("/api/bots/nonexistent/sessions")
    assert r.status_code == 404


def test_session_messages(client):
    kb = client.post("/api/knowledge-bases", json={"name": "kb", "description": ""}).json()
    bot = client.post("/api/bots", json={"name": "b", "system_prompt": "", "kb_ids": [kb["id"]]}).json()
    r = client.post("/v1/responses", json={"model": f"bot:{bot['id']}", "input": "hello"})
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
    r = client.post("/v1/responses", json={"model": f"bot:{bot['id']}", "input": "hello"})
    assert r.status_code == 200
    data = r.json()
    assert "output" in data


def test_chat_stream(client):
    kb = client.post("/api/knowledge-bases", json={"name": "kb", "description": ""}).json()
    bot = client.post("/api/bots", json={"name": "b", "system_prompt": "", "kb_ids": [kb["id"]]}).json()

    with client.stream("POST", "/v1/responses", json={"model": f"bot:{bot['id']}", "input": "hello", "stream": True}) as r:
        assert r.status_code == 200
        lines = [line for line in r.iter_lines() if line.startswith("data: ")]
        events = [json.loads(line[6:]) for line in lines if line[6:] != "[DONE]"]

    types = [e["type"] for e in events]
    assert "response.created" in types
    assert "response.text.delta" in types
    assert "response.completed" in types

    deltas = [event.get("delta") for event in events if event.get("type") == "response.text.delta"]
    assert len(deltas) >= 1
    assert "".join(deltas) == "[mock agentic response]"

    final = events[-1]
    assert final["type"] == "response.completed"
    assert final["response"]["status"] == "completed"
    assert "output" in final["response"]


# ── Vault API tests ───────────────────────────────────────────────────────────

def test_vault_bind_local(client):
    kb = client.post("/api/knowledge-bases", json={"name": "kb1", "description": "", "type": "vault"}).json()
    r = client.post(f"/api/knowledge-bases/{kb['id']}/vault",
                    json={"type": "local", "local_path": "/tmp/vault"})
    assert r.status_code == 201
    data = r.json()
    assert data["type"] == "local"
    assert data["local_path"] == "/tmp/vault"
    assert "webdav_password" not in data




def test_vault_bind_webdav_persists_path_without_password(client):
    from unittest.mock import patch

    kb = client.post("/api/knowledge-bases", json={"name": "kb1", "description": "", "type": "vault"}).json()
    with patch("memoria.server.routes.vaults.threading.Thread"):
        r = client.post(f"/api/knowledge-bases/{kb['id']}/vault", json={
            "type": "webdav",
            "webdav_url": "https://dav.example.com/remote.php/dav/files/me",
            "webdav_path": "/Notes",
            "webdav_username": "me",
            "webdav_password": "secret",
        })
    assert r.status_code == 201
    data = r.json()
    assert data["type"] == "webdav"
    assert data["webdav_path"] == "/Notes"
    assert "webdav_password" not in data


def test_vault_browse_local_returns_directories(client, tmp_path):
    root = tmp_path / "vaults"
    child = root / "Notes"
    child.mkdir(parents=True)
    (root / "note.md").write_text("ignored")

    r = client.post("/api/vaults/browse-local", json={"path": str(root)})

    assert r.status_code == 200
    data = r.json()
    assert data["path"] == str(root.resolve())
    assert {entry["path"] for entry in data["entries"]} == {str(child.resolve())}


def test_vault_test_webdav_uses_path(client):
    from unittest.mock import patch

    with patch("memoria.server.routes.vaults.WebDAVConnector") as connector_cls:
        connector_cls.return_value.list_files.return_value = ["a.md", "nested/b.txt"]
        r = client.post("/api/vaults/test-webdav", json={
            "webdav_url": "https://dav.example.com",
            "webdav_path": "Notes",
            "webdav_username": "me",
            "webdav_password": "secret",
        })

    assert r.status_code == 200
    assert r.json() == {"ok": True, "file_count": 2, "path": "/Notes"}
    connector_cls.assert_called_once_with("https://dav.example.com", "me", "secret", "Notes")


def test_vault_get(client):
    kb = client.post("/api/knowledge-bases", json={"name": "kb1", "description": "", "type": "vault"}).json()
    client.post(f"/api/knowledge-bases/{kb['id']}/vault",
                json={"type": "local", "local_path": "/tmp/vault"})
    r = client.get(f"/api/knowledge-bases/{kb['id']}/vault")
    assert r.status_code == 200
    assert r.json()["type"] == "local"


def test_vault_get_not_found(client):
    kb = client.post("/api/knowledge-bases", json={"name": "kb1", "description": "", "type": "vault"}).json()
    r = client.get(f"/api/knowledge-bases/{kb['id']}/vault")
    assert r.status_code == 404


def test_vault_duplicate_bind_409(client):
    kb = client.post("/api/knowledge-bases", json={"name": "kb1", "description": "", "type": "vault"}).json()
    client.post(f"/api/knowledge-bases/{kb['id']}/vault",
                json={"type": "local", "local_path": "/tmp/vault"})
    r = client.post(f"/api/knowledge-bases/{kb['id']}/vault",
                    json={"type": "local", "local_path": "/tmp/vault2"})
    assert r.status_code == 409


def test_vault_delete_unbind(client):
    kb = client.post("/api/knowledge-bases", json={"name": "kb1", "description": "", "type": "vault"}).json()
    client.post(f"/api/knowledge-bases/{kb['id']}/vault",
                json={"type": "local", "local_path": "/tmp/vault"})
    r = client.delete(f"/api/knowledge-bases/{kb['id']}/vault")
    assert r.status_code == 204
    r2 = client.get(f"/api/knowledge-bases/{kb['id']}/vault")
    assert r2.status_code == 404


def test_vault_delete_not_found(client):
    kb = client.post("/api/knowledge-bases", json={"name": "kb1", "description": "", "type": "vault"}).json()
    r = client.delete(f"/api/knowledge-bases/{kb['id']}/vault")
    assert r.status_code == 404


def test_vault_sync_returns_202(client):
    import time
    kb = client.post("/api/knowledge-bases", json={"name": "kb1", "description": "", "type": "vault"}).json()
    client.post(f"/api/knowledge-bases/{kb['id']}/vault",
                json={"type": "local", "local_path": "/tmp/vault"})
    time.sleep(0.5)  # wait for _initial_sync thread to finish
    r = client.post(f"/api/knowledge-bases/{kb['id']}/vault/sync")
    assert r.status_code == 202


def test_vault_sync_no_vault_404(client):
    kb = client.post("/api/knowledge-bases", json={"name": "kb1", "description": "", "type": "vault"}).json()
    r = client.post(f"/api/knowledge-bases/{kb['id']}/vault/sync")
    assert r.status_code == 404


def test_vault_doc_delete_409(client, tmp_path):
    """Vault-sourced documents must not be manually deletable (409)."""
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


# ── vault-sync-control tests ──────────────────────────────────────────────────

def test_vault_sync_409_when_syncing(client):
    """POST /sync while syncing=True must return 409."""
    import time
    kb = client.post("/api/knowledge-bases", json={"name": "kb1", "description": "", "type": "vault"}).json()
    client.post(f"/api/knowledge-bases/{kb['id']}/vault",
                json={"type": "local", "local_path": "/tmp/vault"})
    # Wait for _initial_sync background thread to finish (it will fail fast since /tmp/vault may not exist)
    time.sleep(0.5)
    # Force syncing=True in DB via set_vault_syncing before the request
    from memoria.server.deps import get_db
    db = client.app.dependency_overrides[get_db]()
    vault = db.get_vault_by_kb(kb["id"])
    db.set_vault_syncing(vault["id"], True)
    r = client.post(f"/api/knowledge-bases/{kb['id']}/vault/sync")
    assert r.status_code == 409


def test_vault_cancel_sync_sets_event(client):
    """DELETE /sync must set the cancel event for the running sync."""
    import threading
    import time

    import memoria.server.routes.vaults as vaults_mod
    kb = client.post("/api/knowledge-bases", json={"name": "kb1", "description": "", "type": "vault"}).json()
    client.post(f"/api/knowledge-bases/{kb['id']}/vault",
                json={"type": "local", "local_path": "/tmp/vault"})
    # Wait for _initial_sync background thread to finish
    time.sleep(0.5)
    from memoria.server.deps import get_db
    db = client.app.dependency_overrides[get_db]()
    vault = db.get_vault_by_kb(kb["id"])
    # Manually plant a cancel event as if sync were running
    event = threading.Event()
    vaults_mod._cancel_events[vault["id"]] = event
    r = client.delete(f"/api/knowledge-bases/{kb['id']}/vault/sync")
    assert r.status_code == 204
    assert event.is_set()
    # cleanup
    vaults_mod._cancel_events.pop(vault["id"], None)


def test_vault_cancel_sync_no_vault_404(client):
    """DELETE /sync on kb with no vault returns 404."""
    kb = client.post("/api/knowledge-bases", json={"name": "kb1", "description": "", "type": "vault"}).json()
    r = client.delete(f"/api/knowledge-bases/{kb['id']}/vault/sync")
    assert r.status_code == 404


def test_vault_patch_auto_sync(client):
    """PATCH /vault {auto_sync: false} persists and is reflected in GET."""
    kb = client.post("/api/knowledge-bases", json={"name": "kb1", "description": "", "type": "vault"}).json()
    client.post(f"/api/knowledge-bases/{kb['id']}/vault",
                json={"type": "local", "local_path": "/tmp/vault"})
    r = client.patch(f"/api/knowledge-bases/{kb['id']}/vault", json={"auto_sync": False})
    assert r.status_code == 200
    assert r.json()["auto_sync"] is False
    r2 = client.get(f"/api/knowledge-bases/{kb['id']}/vault")
    assert r2.json()["auto_sync"] is False


def test_vault_patch_no_vault_404(client):
    """PATCH /vault on kb with no vault returns 404."""
    kb = client.post("/api/knowledge-bases", json={"name": "kb1", "description": "", "type": "vault"}).json()
    r = client.patch(f"/api/knowledge-bases/{kb['id']}/vault", json={"auto_sync": True})
    assert r.status_code == 404


# ── Task 4: _sync_all_vaults unit tests ──────────────────────────────────────

def test_sync_all_vaults_skips_auto_sync_false():
    """_sync_all_vaults must skip vaults where auto_sync=False."""
    from unittest.mock import MagicMock, patch

    # Import the module to access the inner function indirectly via patching
    import memoria.server.app as app_mod

    mock_db = MagicMock()
    mock_db.list_vaults.return_value = [
        {"id": "v1", "auto_sync": False, "syncing": False},
        {"id": "v2", "auto_sync": True,  "syncing": False},
    ]
    mock_syncer = MagicMock()

    with patch("memoria.server.app.get_db", return_value=mock_db), \
         patch("memoria.server.app.get_pipeline", return_value=MagicMock()), \
         patch("memoria.server.app.VaultSyncer", return_value=mock_syncer):
        app_mod._sync_all_vaults()

    # Only v2 should be synced
    called_ids = [call.args[0] for call in mock_syncer.sync.call_args_list]
    assert "v1" not in called_ids
    assert "v2" in called_ids


def test_sync_all_vaults_skips_already_syncing():
    """_sync_all_vaults must skip vaults where syncing=True."""
    from unittest.mock import MagicMock, patch

    import memoria.server.app as app_mod

    mock_db = MagicMock()
    mock_db.list_vaults.return_value = [
        {"id": "v1", "auto_sync": True, "syncing": True},
        {"id": "v2", "auto_sync": True, "syncing": False},
    ]
    mock_syncer = MagicMock()

    with patch("memoria.server.app.get_db", return_value=mock_db), \
         patch("memoria.server.app.get_pipeline", return_value=MagicMock()), \
         patch("memoria.server.app.VaultSyncer", return_value=mock_syncer):
        app_mod._sync_all_vaults()

    called_ids = [call.args[0] for call in mock_syncer.sync.call_args_list]
    assert "v1" not in called_ids
    assert "v2" in called_ids


# ── Task 5: vault_sync_interval_minutes settings tests ───────────────────────

def test_settings_vault_sync_interval_persisted(client):
    """PUT /settings {vault_sync_interval_minutes: 5} persists; GET returns it as '5'."""
    r = client.put("/api/settings", json={"vault_sync_interval_minutes": 5})
    assert r.status_code == 200
    assert r.json()["vault_sync_interval_minutes"] == "5"
    r2 = client.get("/api/settings")
    assert r2.json()["vault_sync_interval_minutes"] == "5"


def test_settings_vault_sync_interval_reschedule_safe_without_scheduler(client):
    """PUT /settings with vault_sync_interval_minutes must not fail when no scheduler on app.state."""
    r = client.put("/api/settings", json={"vault_sync_interval_minutes": 10})
    assert r.status_code == 200


def test_delete_session(client):
    kb = client.post("/api/knowledge-bases", json={"name": "kb", "description": ""}).json()
    bot = client.post("/api/bots", json={"name": "b", "system_prompt": "", "kb_ids": [kb["id"]]}).json()
    chat = client.post("/v1/responses", json={"model": f"bot:{bot['id']}", "input": "hello"}).json()
    session_id = chat["session_id"]

    r = client.delete(f"/api/sessions/{session_id}")
    assert r.status_code == 204

    # 再次删除应返回 404
    r2 = client.delete(f"/api/sessions/{session_id}")
    assert r2.status_code == 404


def test_delete_session_not_found(client):
    r = client.delete("/api/sessions/nonexistent")
    assert r.status_code == 404

def test_fetch_models(client):
    from unittest.mock import MagicMock, patch
    mock_model_1 = MagicMock()
    mock_model_1.id = "gpt-4o"
    mock_model_2 = MagicMock()
    mock_model_2.id = "text-embedding-3-small"

    mock_client = MagicMock()
    mock_client.models.list.return_value.data = [mock_model_1, mock_model_2]

    with patch("openai.OpenAI", return_value=mock_client):
        r = client.post("/api/settings/fetch-models", json={"openai_base_url": "https://api.openai.com/v1", "api_key": "sk-123"})
        assert r.status_code == 200
        assert r.json() == {"models": ["gpt-4o", "text-embedding-3-small"]}


def test_openai_models(client):
    kb = client.post("/api/knowledge-bases", json={"name": "kb", "description": ""}).json()
    bot = client.post("/api/bots", json={"name": "test_bot", "system_prompt": "", "kb_ids": [kb["id"]]}).json()
    r = client.get("/v1/models")
    assert r.status_code == 200
    data = r.json()
    assert data["object"] == "list"
    model_ids = [m["id"] for m in data["data"]]
    assert "memoria-agent" in model_ids
    assert f"bot:{bot['model_key']}" in model_ids
    assert bot["model_key"] not in model_ids
    assert bot["id"] not in model_ids
    assert f"bot:{bot['id']}" not in model_ids
    assert len(model_ids) == len(set(model_ids))


def test_api_logs_and_clear(client):
    kb = client.post("/api/knowledge-bases", json={"name": "kb", "description": ""}).json()
    bot = client.post("/api/bots", json={"name": "test_bot", "system_prompt": "", "kb_ids": [kb["id"]]}).json()
    r = client.post("/v1/chat/completions", json={"model": bot["id"], "messages": [{"role": "user", "content": "test log"}]})
    assert r.status_code == 200

    logs_res = client.get("/api/logs/invocations")
    assert logs_res.status_code == 200
    logs_data = logs_res.json()
    assert len(logs_data["items"]) >= 1
    last_log = logs_data["items"][0]
    assert last_log["endpoint"] == "/v1/chat/completions"
    assert last_log["model"] == bot["name"]
    assert last_log["status_code"] == 200
    assert "duration_ms" in last_log
    assert "total_tokens" in last_log

    del_res = client.delete("/api/logs/invocations")
    assert del_res.status_code == 204

    logs_after = client.get("/api/logs/invocations").json()
    assert len(logs_after["items"]) == 0
