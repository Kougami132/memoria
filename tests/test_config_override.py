import pytest
from memoria.storage.db import DB
from memoria.config import get_effective_settings, settings
from memoria.core.pipeline import Pipeline


@pytest.fixture
def db(tmp_path):
    return DB(str(tmp_path / "test.db"))


def test_get_effective_settings_defaults(db):
    result = get_effective_settings(db)
    assert set(result.keys()) == {
        "openai_base_url", "openai_api_key", "embedding_model",
        "llm_model", "top_k", "min_score", "chunk_size", "chunk_overlap",
        "vault_sync_interval_minutes"
    }
    assert result["top_k"] == str(settings.top_k)
    assert result["chunk_size"] == str(settings.chunk_size)
    assert result["min_score"] == str(settings.min_score)
    assert result["vault_sync_interval_minutes"] == "15"


def test_get_effective_settings_override(db):
    db.set_setting("top_k", "10")
    db.set_setting("llm_model", "gpt-4o")
    result = get_effective_settings(db)
    assert result["top_k"] == "10"
    assert result["llm_model"] == "gpt-4o"
    assert result["chunk_size"] == str(settings.chunk_size)  # unchanged default


def test_reset_pipeline_rebuilds(monkeypatch):
    monkeypatch.setenv("USE_MOCK", "true")
    from memoria.server import deps
    deps.reset_pipeline()
    assert deps._pipeline is None
    pipeline = deps.get_pipeline()
    assert pipeline is not None
    assert deps._pipeline is pipeline
    deps.reset_pipeline()
    assert deps._pipeline is None
