import pytest
from memoria.storage.db import DB
from memoria.config import get_effective_settings


@pytest.fixture
def db(tmp_path):
    return DB(str(tmp_path / "test.db"))


def test_get_effective_settings_defaults(db):
    result = get_effective_settings(db)
    assert set(result.keys()) == {
        "openai_base_url", "openai_api_key", "embedding_model",
        "llm_model", "top_k", "chunk_size", "chunk_overlap"
    }
    assert result["top_k"] == "5"
    assert result["chunk_size"] == "512"


def test_get_effective_settings_override(db):
    db.set_setting("top_k", "10")
    db.set_setting("llm_model", "gpt-4o")
    result = get_effective_settings(db)
    assert result["top_k"] == "10"
    assert result["llm_model"] == "gpt-4o"
    assert result["chunk_size"] == "512"  # unchanged default
