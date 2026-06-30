"""Tests for VaultSyncer diff logic."""
import pytest
import threading
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


def test_ingest_file_stores_rel_path_as_doc_path(db, tmp_path):
    """After sync, vault-sourced doc.path should be rel_path (not temp file path)."""
    from memoria.core.pipeline import Pipeline
    from unittest.mock import MagicMock

    # Create real pipeline with mocked embedder
    embedder = MagicMock()
    embedder.embed.return_value = [[0.1, 0.2]]
    llm = MagicMock()

    pipeline = Pipeline(db=db, embedder=embedder, llm=llm,
                       chroma_path=str(tmp_path / "chroma"), top_k=5)

    # Setup vault
    kb = db.create_kb("kb1", "")
    vault = db.create_vault(kb["id"], "local", local_path=str(tmp_path / "vault"))
    vault_dir = tmp_path / "vault"
    vault_dir.mkdir()
    (vault_dir / "note.md").write_text("hello world")

    # Run sync with real pipeline
    syncer = VaultSyncer(db, pipeline)
    syncer.sync(vault["id"])

    # Verify the doc was created with rel_path as path, not temp file path
    files = db.list_vault_files(vault["id"])
    assert len(files) == 1
    doc_id = files[0]["doc_id"]

    doc = db.get_doc(doc_id)
    assert doc is not None
    assert doc["path"] == "note.md"  # Should be rel_path, not /tmp/xyz/...
    assert not doc["path"].startswith(str(tmp_path))  # Should NOT be temp file path


def test_sync_cancel_event_stops_new_files(db, pipeline, vault_with_local):
    """cancel_event set() should stop processing new_files after first file."""
    kb, vault, vault_dir = vault_with_local
    (vault_dir / "file1.md").write_text("content 1")
    (vault_dir / "file2.md").write_text("content 2")
    (vault_dir / "file3.md").write_text("content 3")

    cancel_event = threading.Event()
    cancel_event.set()  # Pre-set to stop immediately

    syncer = VaultSyncer(db, pipeline)
    syncer.sync(vault["id"], cancel_event=cancel_event)

    # Only first file should be processed before cancellation
    files = db.list_vault_files(vault["id"])
    assert len(files) == 1
    assert pipeline.ingest.call_count == 1


def test_sync_without_cancel_event(db, pipeline, vault_with_local):
    """Without cancel_event, sync() should work normally (backward compatibility)."""
    kb, vault, vault_dir = vault_with_local
    (vault_dir / "file1.md").write_text("content 1")
    (vault_dir / "file2.md").write_text("content 2")
    (vault_dir / "file3.md").write_text("content 3")

    syncer = VaultSyncer(db, pipeline)
    syncer.sync(vault["id"])  # No cancel_event

    # All files should be processed
    files = db.list_vault_files(vault["id"])
    assert len(files) == 3
    assert pipeline.ingest.call_count == 3
