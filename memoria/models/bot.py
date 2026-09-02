from pydantic import BaseModel


class Bot(BaseModel):
    id: str
    name: str
    model_key: str = ""
    system_prompt: str = ""
    kb_ids: list[str] = []
    host_ids: list[str] = []
    model_override: str | None = None
