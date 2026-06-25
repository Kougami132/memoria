from pydantic import BaseModel


class Document(BaseModel):
    id: str
    kb_id: str
    filename: str
    path: str
    chunk_count: int = 0
