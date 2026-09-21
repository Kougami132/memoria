import asyncio
import pytest

from memoria.storage.db import DB
from memoria.tasks.queue import SqliteTaskQueue


@pytest.fixture
def task_queue(tmp_path):
    db = DB(str(tmp_path / "tasks_test.db"))
    queue = SqliteTaskQueue(db=db, poll_interval=0.05)
    return queue


@pytest.mark.asyncio
async def test_enqueue_and_process_task(task_queue):
    executed = []

    async def sample_handler(payload):
        executed.append(payload)
        return {"processed": True, "count": payload.get("val", 0) * 2}

    task_queue.register_handler("test_action", sample_handler)
    await task_queue.start()

    try:
        task_id = await task_queue.enqueue("test_action", {"val": 21})
        assert task_id

        # Wait for task completion
        for _ in range(50):
            task = await task_queue.get_task(task_id)
            if task and task["status"] in ("completed", "failed"):
                break
            await asyncio.sleep(0.05)

        assert task["status"] == "completed"
        assert task["result"] == {"processed": True, "count": 42}
        assert executed == [{"val": 21}]
    finally:
        await task_queue.stop()


@pytest.mark.asyncio
async def test_task_failure_handling(task_queue):
    async def failing_handler(payload):
        raise ValueError("Something went wrong intentionally")

    task_queue.register_handler("fail_action", failing_handler)
    await task_queue.start()

    try:
        task_id = await task_queue.enqueue("fail_action", {"foo": "bar"})
        for _ in range(50):
            task = await task_queue.get_task(task_id)
            if task and task["status"] in ("completed", "failed"):
                break
            await asyncio.sleep(0.05)

        assert task["status"] == "failed"
        assert "Something went wrong intentionally" in task["error"]
    finally:
        await task_queue.stop()


@pytest.mark.asyncio
async def test_unregistered_handler_fails(task_queue):
    await task_queue.start()

    try:
        task_id = await task_queue.enqueue("unknown_action", {})
        for _ in range(50):
            task = await task_queue.get_task(task_id)
            if task and task["status"] in ("completed", "failed"):
                break
            await asyncio.sleep(0.05)

        assert task["status"] == "failed"
        assert "No handler registered" in task["error"]
    finally:
        await task_queue.stop()
