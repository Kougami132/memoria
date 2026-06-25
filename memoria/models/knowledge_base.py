from pydantic import BaseModel


class KnowledgeBase(BaseModel):
    id: str
    name: str
    description: str = ""
