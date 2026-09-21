import asyncio
import logging
import traceback
from typing import Any, Callable, Coroutine, Dict, Optional

from memoria.storage.db import DB
from memoria.tasks.base import BaseTaskQueue

logger = logging.getLogger(__name__)


class SqliteTaskQueue(BaseTaskQueue):
    """
    SQLite-backed persistent task queue with an async polling worker.
    Uses asyncio.Event for instant wakeup on new enqueue, with a fallback poll interval.
    """

    def __init__(self, db: DB, poll_interval: float = 1.0) -> None:
        self.db = db
        self.poll_interval = poll_interval
        self._handlers: Dict[str, Callable[[Dict[str, Any]], Coroutine[Any, Any, Any]]] = {}
        self._worker_task: Optional[asyncio.Task] = None
        self._wakeup_event: Optional[asyncio.Event] = None
        self._running = False

    def register_handler(
        self,
        task_type: str,
        handler: Callable[[Dict[str, Any]], Coroutine[Any, Any, Any]],
    ) -> None:
        self._handlers[task_type] = handler

    async def enqueue(self, task_type: str, payload: Dict[str, Any]) -> str:
        # Synchronously write task into SQLite via DB method run in thread or directly
        task = await asyncio.to_thread(self.db.create_task, task_type, payload)
        if self._wakeup_event and not self._wakeup_event.is_set():
            self._wakeup_event.set()
        return task["id"]

    async def get_task(self, task_id: str) -> Optional[Dict[str, Any]]:
        return await asyncio.to_thread(self.db.get_task, task_id)

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        self._wakeup_event = asyncio.Event()
        self._worker_task = asyncio.create_task(self._worker_loop())
        logger.info("SqliteTaskQueue worker started.")

    async def stop(self) -> None:
        if not self._running:
            return
        self._running = False
        if self._wakeup_event:
            self._wakeup_event.set()
        if self._worker_task:
            self._worker_task.cancel()
            try:
                await self._worker_task
            except asyncio.CancelledError:
                pass
            self._worker_task = None
        logger.info("SqliteTaskQueue worker stopped.")

    async def process_next(self) -> bool:
        """Fetch and execute a single pending task if available. Returns True if a task was processed."""
        task = await asyncio.to_thread(self.db.fetch_next_pending_task)
        if not task:
            return False

        task_id = task["id"]
        task_type = task["task_type"]
        payload = task.get("payload") or {}

        # Mark as running
        await asyncio.to_thread(self.db.update_task_status, task_id, "running")

        handler = self._handlers.get(task_type)
        if not handler:
            err_msg = f"No handler registered for task type: {task_type}"
            logger.error(err_msg)
            await asyncio.to_thread(
                self.db.update_task_status,
                task_id,
                "failed",
                error=err_msg,
            )
            return True

        try:
            res = await handler(payload)
            result_dict = res if isinstance(res, dict) else {"data": res}
            await asyncio.to_thread(
                self.db.update_task_status,
                task_id,
                "completed",
                result=result_dict,
            )
        except Exception as ex:
            tb = traceback.format_exc()
            logger.error("Task %s (%s) failed: %s\n%s", task_id, task_type, ex, tb)
            await asyncio.to_thread(
                self.db.update_task_status,
                task_id,
                "failed",
                error=f"{ex}\n{tb}",
            )
        return True

    async def _worker_loop(self) -> None:
        while self._running:
            try:
                task = await asyncio.to_thread(self.db.fetch_next_pending_task)
                if not task:
                    # Wait for wakeup or timeout
                    if self._wakeup_event:
                        try:
                            await asyncio.wait_for(self._wakeup_event.wait(), timeout=self.poll_interval)
                            self._wakeup_event.clear()
                        except asyncio.TimeoutError:
                            pass
                    else:
                        await asyncio.sleep(self.poll_interval)
                    continue

                task_id = task["id"]
                task_type = task["task_type"]
                payload = task.get("payload") or {}

                # Mark as running
                await asyncio.to_thread(self.db.update_task_status, task_id, "running")

                handler = self._handlers.get(task_type)
                if not handler:
                    err_msg = f"No handler registered for task type: {task_type}"
                    logger.error(err_msg)
                    await asyncio.to_thread(
                        self.db.update_task_status,
                        task_id,
                        "failed",
                        error=err_msg,
                    )
                    continue

                try:
                    res = await handler(payload)
                    result_dict = res if isinstance(res, dict) else {"data": res}
                    await asyncio.to_thread(
                        self.db.update_task_status,
                        task_id,
                        "completed",
                        result=result_dict,
                    )
                except Exception as ex:
                    tb = traceback.format_exc()
                    logger.error("Task %s (%s) failed: %s\n%s", task_id, task_type, ex, tb)
                    await asyncio.to_thread(
                        self.db.update_task_status,
                        task_id,
                        "failed",
                        error=f"{ex}\n{tb}",
                    )
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("Error in task queue worker loop: %s", e)
                await asyncio.sleep(self.poll_interval)
