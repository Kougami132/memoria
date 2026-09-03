import json

DEFAULT_HOST_DANGEROUS_PATTERNS = [
    r"\brm\s+-(?:[a-zA-Z]*r[a-zA-Z]*f|[a-zA-Z]*f[a-zA-Z]*r)\s+(?:/|/\*|\.\.|\./\.\.)(?:\s|$)",
    r"\brm\s+-[a-zA-Z]*\s+(?:/|/\*)(?:\s|$)",
    r"\bmkfs(?:\.\w+)?\b",
    r"\bfdisk\b",
    r"\bdd\s+if=.*of=/dev/[a-z0-9]+",
    r"\b(?:reboot|shutdown|poweroff|init\s+0|init\s+6)\b",
    r">\s*/dev/(?:sd[a-z]|nvme[0-9]|hd[a-z])",
]

from pydantic_settings import BaseSettings

DEFAULT_SYSTEM_PROMPT = """你是一个专业的智能助手，请始终用用户所使用的语言回复。

如果系统提供了参考资料，请优先基于参考资料回答问题，并保持回答简洁准确。若参考资料不足以回答问题，可结合自身知识补充，但需说明哪部分来自推断而非资料。"""


class Settings(BaseSettings):
    openai_base_url: str = "http://localhost"
    openai_api_key: str = "mock"
    external_api_token: str = ""
    use_mock: bool = False
    embedding_model: str = "text-embedding-3-large"
    llm_model: str = "deepseek-v4-flash"
    system_prompt: str = DEFAULT_SYSTEM_PROMPT
    chunk_size: int = 512
    chunk_overlap: int = 128
    top_k: int = 5
    min_score: float = 0.5
    db_path: str = "./data/memoria.db"
    chroma_path: str = "./data/chroma"
    upload_dir: str = "./data/uploads"
    log_path: str = "./data/memoria.log"

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()


def get_effective_settings(db) -> dict:
    overrides = db.get_all_settings()
    fields = {
        "openai_base_url": str(settings.openai_base_url),
        "openai_api_key": str(settings.openai_api_key),
        "external_api_token": str(settings.external_api_token),
        "embedding_model": str(settings.embedding_model),
        "llm_model": str(settings.llm_model),
        "system_prompt": str(settings.system_prompt),
        "top_k": str(settings.top_k),
        "min_score": str(settings.min_score),
        "chunk_size": str(settings.chunk_size),
        "chunk_overlap": str(settings.chunk_overlap),
        "vault_sync_interval_minutes": "15",
        "host_dangerous_patterns": json.dumps(DEFAULT_HOST_DANGEROUS_PATTERNS),
    }
    fields.update({k: v for k, v in overrides.items() if k in fields})
    url = fields["openai_base_url"].rstrip("/")
    if not url.endswith("/v1"):
        url += "/v1"
    fields["openai_base_url"] = url
    return fields


QQ_SETTING_KEYS = (
    "enabled", "app_id", "client_secret", "gateway_intents", "c2c_enabled",
    "group_enabled", "group_require_mention", "user_allowlist", "group_allowlist",
    "allow_unlisted_users", "allow_unlisted_groups", "group_approval_enabled",
    "max_queue_size", "run_timeout_seconds",
)


def get_qq_settings(db) -> dict:
    values = {
        key.removeprefix("qq_"): value
        for key, value in db.get_all_settings().items()
        if key.startswith("qq_")
    }
    defaults = {
        "enabled": "false", "app_id": "", "client_secret": "", "gateway_intents": "0",
        "c2c_enabled": "true", "group_enabled": "true", "group_require_mention": "true",
        "user_allowlist": "[]", "group_allowlist": "[]", "allow_unlisted_users": "false",
        "allow_unlisted_groups": "false", "group_approval_enabled": "false",
        "max_queue_size": "32", "run_timeout_seconds": "300",
    }
    for key in QQ_SETTING_KEYS:
        if key in values:
            defaults[key] = values[key]
    return defaults
