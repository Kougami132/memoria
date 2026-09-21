from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from memoria.server.deps import get_task_queue
from memoria.tasks.base import BaseTaskQueue

router = APIRouter(tags=["tasks"])


class TaskResponse(BaseModel):
    id: str
    task_type: str
    status: str
    payload: dict
    result: Optional[dict] = None
    error: Optional[str] = None
    created_at: str
    updated_at: str


@router.get("/tasks/{task_id}", response_model=TaskResponse)
async def get_task_status(
    task_id: str,
    task_queue: BaseTaskQueue = Depends(get_task_queue),
):
    task = await task_queue.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task
