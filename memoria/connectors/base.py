from __future__ import annotations

from abc import ABC, abstractmethod
from enum import Enum
from typing import Any
from pydantic import BaseModel, Field


class ResourceType(str, Enum):
    KNOWLEDGE_BASE = "knowledge_base"
    HOST = "host"
    DATABASE = "database"
    API = "api"
    REPOSITORY = "repository"


class ResourceMetadata(BaseModel):
    id: str
    name: str
    type: ResourceType
    description: str = ""
    extra: dict[str, Any] = Field(default_factory=dict)


class BaseConnector(ABC):
    """Abstract base class for all pluggable resource connectors in Memoria."""

    def __init__(self, resource_id: str, name: str, description: str = "") -> None:
        self.resource_id = resource_id
        self.name = name
        self.description = description

    @property
    @abstractmethod
    def resource_type(self) -> ResourceType:
        """Return the ResourceType handled by this connector."""
        raise NotImplementedError

    @abstractmethod
    def test_connection(self) -> dict[str, Any]:
        """Test connectivity and health of the target resource.

        Returns a dict with `status` (success/error/warning), `latency_ms`, and `message`.
        """
        raise NotImplementedError

    @abstractmethod
    def get_metadata(self) -> ResourceMetadata:
        """Return standardized resource metadata."""
        raise NotImplementedError

    @abstractmethod
    def get_summary_for_context(self) -> str:
        """Generate a compact summary text suitable for LLM prompt context injection."""
        raise NotImplementedError

    def get_tools(self) -> list[Any]:
        """Optional list of callable agent tools or tool definitions provided by this connector."""
        return []
