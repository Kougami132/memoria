from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    openai_base_url: str = "http://localhost"
    openai_api_key: str = "mock"
    use_mock: bool = False
    embedding_model: str = "text-embedding-3-large"
    llm_model: str = "deepseek-v4-flash"
    chunk_size: int = 512
    chunk_overlap: int = 128
    top_k: int = 5
    db_path: str = "./data/memoria.db"
    chroma_path: str = "./data/chroma"
    upload_dir: str = "./data/uploads"

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()


def get_effective_settings(db) -> dict:
    overrides = db.get_all_settings()
    fields = {
        "openai_base_url": str(settings.openai_base_url),
        "openai_api_key": str(settings.openai_api_key),
        "embedding_model": str(settings.embedding_model),
        "llm_model": str(settings.llm_model),
        "top_k": str(settings.top_k),
        "chunk_size": str(settings.chunk_size),
        "chunk_overlap": str(settings.chunk_overlap),
    }
    fields.update({k: v for k, v in overrides.items() if k in fields})
    return fields
