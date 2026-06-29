"""Tests for VaultSyncer diff logic."""
import pytest
from unittest.mock import MagicMock, patch
from memoria.vault.syncer import VaultSyncer


@pytest.fixture
def db(tmp_path):
    from memoria.storage.db import DB
    return DB(str(tmp_path / "test.db"))


@pytest.fixture
def pipeline():
    p = MagicMock()
    p.ingest.return_value = {"doc": {"id": "doc-1", "source": "vault"}, "doc_id": "doc-1", "chunk_count": 2}
    return p


@pytest.fixture
def vault_with_local(db, tmp_path):
    kb = db.create_kb("kb1", "")
    vault = db.create_vault(kb["id"], "local", local_path=str(tmp_path / "vault"))
    vault_dir = tmp_path / "vault"
    vault_dir.mkdir()
    return kb, vault, vault_dir


def test_sync_new_file_ingested(db, pipeline, vault_with_local):
    kb, vault, vault_dir = vault_with_local
    (vault_dir / "note.md").write_text("hello world")

    syncer = VaultSyncer(db, pipeline)
    syncer.sync(vault["id"])

    pipeline.ingest.assert_called_once()
    files = db.list_vault_files(vault["id"])
    assert len(files) == 1
    assert files[0]["rel_path"] == "note.md"
    assert files[0]["doc_id"] == "doc-1"

    updated = db.get_vault(vault["id"])
    assert updated["last_synced_at"] is not None


def test_sync_unchanged_file_not_reingested(db, pipeline, vault_with_local):
    kb, vault, vault_dir = vault_with_local
    (vault_dir / "note.md").write_text("hello world")

    syncer = VaultSyncer(db, pipeline)
    syncer.sync(vault["id"])
    call_count_after_first = pipeline.ingest.call_count

    syncer.sync(vault["id"])
    assert pipeline.ingest.call_count == call_count_after_first


def test_sync_changed_file_reingested(db, pipeline, vault_with_local):
    kb, vault, vault_dir = vault_with_local
    note = vault_dir / "note.md"
    note.write_text("version 1")

    pipeline.ingest.return_value = {"doc": {"id": "doc-1"}, "doc_id": "doc-1", "chunk_count": 1}
    syncer = VaultSyncer(db, pipeline)
    syncer.sync(vault["id"])

    note.write_text("version 2 - completely different content")
    pipeline.ingest.return_value = {"doc": {"id": "doc-2"}, "doc_id": "doc-2", "chunk_count": 1}
    syncer.sync(vault["id"])

    assert pipeline.ingest.call_count == 2
    files = db.list_vault_files(vault["id"])
    assert files[0]["doc_id"] == "doc-2"


def test_sync_deleted_file_removes_doc(db, pipeline, vault_with_local):
    kb, vault, vault_dir = vault_with_local
    note = vault_dir / "note.md"
    note.write_text("some content")

    syncer = VaultSyncer(db, pipeline)
    syncer.sync(vault["id"])
    assert len(db.list_vault_files(vault["id"])) == 1

    note.unlink()
    syncer.sync(vault["id"])

    assert len(db.list_vault_files(vault["id"])) == 0
    pipeline.delete_doc.assert_called()


def test_sync_connection_failure_preserves_data(db, pipeline, vault_with_local):
    kb, vault, vault_dir = vault_with_local
    (vault_dir / "note.md").write_text("hello")

    syncer = VaultSyncer(db, pipeline)
    syncer.sync(vault["id"])
    last_synced = db.get_vault(vault["id"])["last_synced_at"]

    # Remove the vault directory to simulate connection failure
    import shutil
    shutil.rmtree(str(vault_dir))

    import time; time.sleep(0.01)
    syncer.sync(vault["id"])

    # Existing vault_files should be preserved
    assert len(db.list_vault_files(vault["id"])) == 1
    # last_synced_at should not have been updated
    assert db.get_vault(vault["id"])["last_synced_at"] == last_synced


def test_pipeline_ingest_source_param(db, tmp_path):
    """pipeline.ingest must accept source kwarg and pass to db.create_doc."""
    from memoria.core.pipeline import Pipeline
    from unittest.mock import MagicMock

    embedder = MagicMock()
    embedder.embed.return_value = [[0.1, 0.2]]

    llm = MagicMock()
    chroma_store = MagicMock()

    p = Pipeline.__new__(Pipeline)
    p.db = db
    p._embedder = embedder
    p._llm = llm
    p._chroma_path = str(tmp_path / "chroma")
    p._top_k = 5
    p._min_score = 0.5
    p._stores = {}

    with patch.object(p, "_get_store") as mock_store:
        mock_store.return_value = MagicMock()
        kb = db.create_kb("kb1", "")
        f = tmp_path / "test.md"
        f.write_text("# Hello\nworld")
        result = p.ingest(kb["id"], str(f), source="vault")

    doc = db.get_doc(result["doc"]["id"])
    assert doc["source"] == "vault"
