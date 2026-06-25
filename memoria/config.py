from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    newapi_base_url: str
    newapi_api_key: str
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


settings = Settings()
