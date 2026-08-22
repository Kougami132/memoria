from __future__ import annotations

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from memoria.connectors.base import BaseConnector, ResourceType

logger = logging.getLogger("memoria.connectors.registry")


class ConnectorRegistry:
    """Central registry for active resource connectors."""

    def __init__(self) -> None:
        # Map: (resource_type, resource_id) -> BaseConnector
        self._connectors: dict[tuple[ResourceType, str], BaseConnector] = {}

    def register(self, connector: BaseConnector) -> None:
        key = (connector.resource_type, connector.resource_id)
        self._connectors[key] = connector
        logger.info("[Connectors] Registered %s connector '%s' (%s)", connector.resource_type.value, connector.name, connector.resource_id)

    def unregister(self, resource_type: ResourceType, resource_id: str) -> BaseConnector | None:
        key = (resource_type, resource_id)
        conn = self._connectors.pop(key, None)
        if conn:
            logger.info("[Connectors] Unregistered %s connector '%s'", resource_type.value, resource_id)
        return conn

    def get(self, resource_type: ResourceType, resource_id: str) -> BaseConnector | None:
        return self._connectors.get((resource_type, resource_id))

    def list(self, resource_type: ResourceType | None = None) -> list[BaseConnector]:
        if resource_type is None:
            return list(self._connectors.values())
        return [conn for (rtype, _), conn in self._connectors.items() if rtype == resource_type]

    def clear(self) -> None:
        self._connectors.clear()
