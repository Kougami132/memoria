import os
from functools import lru_cache

from memoria.config import settings
from memoria.core.embedder import Embedder, MockEmbedder
from memoria.core.pipeline import Pipeline
from memoria.llm.caller import LLMCaller, MockLLMCaller
from memoria.storage.db import DB


@lru_cache
def get_db() -> DB:
    os.makedirs(os.path.dirname(os.path.abspath(settings.db_path)), exist_ok=True)
    return DB(settings.db_path)


@lru_cache
def get_pipeline() -> Pipeline:
    db = get_db()
    if settings.use_mock:
        embedder: Embedder | MockEmbedder = MockEmbedder()
        llm: LLMCaller | MockLLMCaller = MockLLMCaller()
    else:
        embedder = Embedder(settings.newapi_base_url, settings.newapi_api_key, settings.embedding_model)
        llm = LLMCaller(settings.newapi_base_url, settings.newapi_api_key, settings.llm_model)
    os.makedirs(settings.chroma_path, exist_ok=True)
    return Pipeline(db=db, embedder=embedder, llm=llm, chroma_path=settings.chroma_path)
