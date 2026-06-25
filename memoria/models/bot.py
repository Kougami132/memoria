from pydantic import BaseModel


class Bot(BaseModel):
    id: str
    name: str
    system_prompt: str = ""
    kb_ids: list[str] = []
    model_override: str | None = None
