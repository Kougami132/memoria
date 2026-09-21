from abc import ABC, abstractmethod
from typing import Any, Callable, Coroutine, Dict, Optional


class BaseTaskQueue(ABC):
    @abstractmethod
    async def enqueue(self, task_type: str, payload: Dict[str, Any]) -> str:
        """Enqueue a task and return its task_id."""
        raise NotImplementedError

    @abstractmethod
    async def get_task(self, task_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve task details by task_id."""
        raise NotImplementedError

    @abstractmethod
    def register_handler(
        self,
        task_type: str,
        handler: Callable[[Dict[str, Any]], Coroutine[Any, Any, Any]],
    ) -> None:
        """Register a handler callback for a specific task type."""
        raise NotImplementedError

    @abstractmethod
    async def start(self) -> None:
        """Start the background worker(s)."""
        raise NotImplementedError

    @abstractmethod
    async def stop(self) -> None:
        """Stop the background worker(s)."""
        raise NotImplementedError
