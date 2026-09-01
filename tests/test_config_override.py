import pytest

from memoria.config import get_effective_settings, settings
from memoria.storage.db import DB


@pytest.fixture
def db(tmp_path):
    return DB(str(tmp_path / "test.db"))


def test_get_effective_settings_defaults(db):
    result = get_effective_settings(db)
    assert set(result.keys()) == {
        "openai_base_url", "openai_api_key", "external_api_token", "embedding_model",
        "llm_model", "system_prompt", "top_k", "min_score", "chunk_size", "chunk_overlap",
        "vault_sync_interval_minutes", "host_dangerous_patterns"
    }
    assert result["top_k"] == str(settings.top_k)
    assert result["chunk_size"] == str(settings.chunk_size)
    assert result["min_score"] == str(settings.min_score)
    assert result["system_prompt"] == str(settings.system_prompt)
    assert result["vault_sync_interval_minutes"] == "15"
    assert result["external_api_token"] == str(settings.external_api_token)


def test_get_effective_settings_override(db):
    db.set_setting("top_k", "10")
    db.set_setting("llm_model", "gpt-4o")
    db.set_setting("system_prompt", "default assistant")
    db.set_setting("external_api_token", "runtime-token")
    result = get_effective_settings(db)
    assert result["top_k"] == "10"
    assert result["llm_model"] == "gpt-4o"
    assert result["system_prompt"] == "default assistant"
    assert result["external_api_token"] == "runtime-token"
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
