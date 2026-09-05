import io
import os
import zipfile
import pytest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient

from memoria.server.app import create_app
from memoria.storage.db import DB
from memoria.core.pipeline import Pipeline
from memoria.core.embedder import MockEmbedder
from memoria.llm.caller import MockLLMCaller
from memoria.config import get_effective_settings
from memoria.agents.engine import AgenticRagEngine
from memoria.server.deps import get_db, get_pipeline, get_agentic_engine


@pytest.fixture
def client(tmp_path, monkeypatch):
    test_db_path = str(tmp_path / "test.db")
    test_chroma_path = str(tmp_path / "chroma")
    test_upload_path = str(tmp_path / "uploads")
    os.makedirs(test_chroma_path, exist_ok=True)
    os.makedirs(test_upload_path, exist_ok=True)

    monkeypatch.setattr("memoria.config.settings.db_path", test_db_path)
    monkeypatch.setattr("memoria.config.settings.chroma_path", test_chroma_path)
    monkeypatch.setattr("memoria.config.settings.upload_dir", test_upload_path)

    db = DB(test_db_path)

    def _get_test_db():
        return db

    def _get_test_pipeline():
        return Pipeline(db=db, embedder=MockEmbedder(), llm=MockLLMCaller(),
                        chroma_path=test_chroma_path, top_k=5,
                        default_system_prompt=get_effective_settings(db)["system_prompt"])

    def _get_test_engine():
        return AgenticRagEngine(db=db, pipeline=_get_test_pipeline())

    app = create_app(lifespan=None)
    app.dependency_overrides[get_db] = _get_test_db
    app.dependency_overrides[get_pipeline] = _get_test_pipeline
    app.dependency_overrides[get_agentic_engine] = _get_test_engine
    return TestClient(app)


def test_vault_update_config_in_place(client):
    # 1. Create a vault KB
    kb = client.post("/api/knowledge-bases", json={"name": "kb_vault", "type": "vault"}).json()
    kb_id = kb["id"]

    # 2. Bind local vault
    r = client.post(f"/api/knowledge-bases/{kb_id}/vault", json={
        "type": "local",
        "local_path": "/path/machine_a/notes"
    })
    assert r.status_code == 201
    vault = r.json()
    vault_id = vault["id"]
    assert vault["local_path"] == "/path/machine_a/notes"

    # 3. Simulate migrating to machine B: update local_path in place via PATCH
    r_patch = client.patch(f"/api/knowledge-bases/{kb_id}/vault", json={
        "local_path": "/path/machine_b/notes"
    })
    assert r_patch.status_code == 200
    updated = r_patch.json()
    assert updated["id"] == vault_id
    assert updated["local_path"] == "/path/machine_b/notes"

    # 4. Switch to WebDAV without recreating vault or clearing docs
    r_patch_webdav = client.patch(f"/api/knowledge-bases/{kb_id}/vault", json={
        "type": "webdav",
        "webdav_url": "https://dav.newhost.internal",
        "webdav_path": "/RemoteNotes",
        "webdav_username": "user123",
        "webdav_password": "secretpassword"
    })
    assert r_patch_webdav.status_code == 200
    updated_webdav = r_patch_webdav.json()
    assert updated_webdav["type"] == "webdav"
    assert updated_webdav["webdav_url"] == "https://dav.newhost.internal"
    assert updated_webdav["webdav_path"] == "/RemoteNotes"
    assert "webdav_password" not in updated_webdav  # Masked password


def test_vault_sync_safety_guard_prevents_vector_deletion():
    from memoria.vault.syncer import VaultSyncer

    mock_db = MagicMock()
    mock_pipeline = MagicMock()

    # Suppose 5 files were already tracked and indexed in Chroma
    mock_db.get_vault.return_value = {
        "id": "v1", "kb_id": "kb1", "type": "local", "local_path": "/tmp/test"
    }
    mock_db.list_vault_files.return_value = [
        {"id": f"vf{i}", "rel_path": f"note_{i}.md", "doc_id": f"doc_{i}", "file_hash": f"hash_{i}"}
        for i in range(5)
    ]

    syncer = VaultSyncer(mock_db, mock_pipeline)

    # Mock connector returning empty files (e.g. network disconnect or unmounted drive)
    mock_connector = MagicMock()
    mock_connector.list_files.return_value = []
    syncer._make_connector = MagicMock(return_value=mock_connector)

    result = syncer.sync("v1")

    # Guard should abort
    assert result is False
    # No documents should be deleted!
    assert mock_pipeline.delete_doc.call_count == 0
    assert mock_db.delete_vault_file.call_count == 0


def test_vault_sync_skips_embedding_for_unchanged_hash():
    from memoria.vault.syncer import VaultSyncer

    mock_db = MagicMock()
    mock_pipeline = MagicMock()

    mock_db.get_vault.return_value = {
        "id": "v1", "kb_id": "kb1", "type": "local", "local_path": "/tmp/test"
    }
    # File exists with known hash
    import hashlib
    content = b"# Hello world"
    content_hash = hashlib.sha256(content).hexdigest()

    mock_db.list_vault_files.return_value = [
        {"id": "vf1", "rel_path": "doc1.md", "doc_id": "doc_1", "file_hash": content_hash}
    ]

    syncer = VaultSyncer(mock_db, mock_pipeline)
    mock_connector = MagicMock()
    mock_connector.list_files.return_value = ["doc1.md"]
    mock_connector.read_file.return_value = content
    syncer._make_connector = MagicMock(return_value=mock_connector)

    result = syncer.sync("v1")
    assert result is True
    # pipeline.ingest should NOT be called (0 tokens wasted)
    assert mock_pipeline.ingest.call_count == 0
    assert mock_pipeline.delete_doc.call_count == 0


def test_export_and_import_backup(client):
    # 1. Create data
    kb = client.post("/api/knowledge-bases", json={"name": "test_kb", "type": "upload"}).json()

    # 2. Export backup
    r_export = client.get("/api/settings/backup/export")
    assert r_export.status_code == 200
    assert r_export.headers.get("content-type") == "application/zip"
    zip_bytes = r_export.content

    # Inspect zip contents
    with zipfile.ZipFile(io.BytesIO(zip_bytes), "r") as zf:
        names = zf.namelist()
        assert "manifest.json" in names
        assert "db/memoria.db" in names

    # 3. Import backup
    r_import = client.post(
        "/api/settings/backup/import",
        files={"file": ("backup.zip", io.BytesIO(zip_bytes), "application/zip")}
    )
    assert r_import.status_code == 200
    res = r_import.json()
    assert res["ok"] is True
    assert res["kbs_count"] >= 1
