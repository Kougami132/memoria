from memoria.connectors.registry import ConnectorRegistry
import logging
import os
from functools import lru_cache

from memoria.agents.engine import AgenticRagEngine
from memoria.config import get_effective_settings, settings
from memoria.core.embedder import Embedder, MockEmbedder
from memoria.core.pipeline import Pipeline
from memoria.llm.caller import LLMCaller, MockLLMCaller
from memoria.storage.db import DB

logger = logging.getLogger(__name__)

_pipeline: Pipeline | None = None
_agentic_engine: AgenticRagEngine | None = None


@lru_cache
def get_db() -> DB:
    os.makedirs(os.path.dirname(os.path.abspath(settings.db_path)), exist_ok=True)
    return DB(settings.db_path)


def get_pipeline() -> Pipeline:
    global _pipeline
    if _pipeline is None:
        db = get_db()
        effective = get_effective_settings(db)
        if settings.use_mock:
            embedder: Embedder | MockEmbedder = MockEmbedder()
            llm: LLMCaller | MockLLMCaller = MockLLMCaller()
        else:
            embedder = Embedder(effective["openai_base_url"], effective["openai_api_key"],
                                effective["embedding_model"])
            llm = LLMCaller(effective["openai_base_url"], effective["openai_api_key"],
                            effective["llm_model"])
            logger.info("Pipeline using base_url=%s embedding_model=%s llm_model=%s",
                        effective["openai_base_url"], effective["embedding_model"], effective["llm_model"])
        os.makedirs(settings.chroma_path, exist_ok=True)
        _pipeline = Pipeline(db=db, embedder=embedder, llm=llm, chroma_path=settings.chroma_path,
                             top_k=int(effective["top_k"]),
                             min_score=float(effective["min_score"]),
                             default_system_prompt=effective["system_prompt"])
    return _pipeline


def get_agentic_engine() -> AgenticRagEngine:
    global _agentic_engine
    if _agentic_engine is None:
        _agentic_engine = AgenticRagEngine(db=get_db(), pipeline=get_pipeline())
    return _agentic_engine


def reset_pipeline() -> None:
    global _pipeline, _agentic_engine
    _pipeline = None
    _agentic_engine = None

_registry: ConnectorRegistry | None = None


def get_registry() -> ConnectorRegistry:
    global _registry
    if _registry is None:
        from memoria.connectors.registry import ConnectorRegistry
        from memoria.connectors.host.connector import HostConnector
        from memoria.connectors.host.models import HostConfig
        _registry = ConnectorRegistry()
        db = get_db()
        # Preload registered hosts with decrypted credentials
        for host in db.list_hosts(decrypt=True):
            try:
                _registry.register(HostConnector(HostConfig(**host)))
            except Exception as e:
                logger.warning("Failed to preload host connector %s: %s", host.get("id"), e)
    return _registry
