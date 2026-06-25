def ingest(kb_id: str, path: str | list[str]) -> dict:
    raise NotImplementedError


def retrieve(kb_id: str, query: str, k: int = 5) -> list[dict]:
    raise NotImplementedError


def query(bot_id: str, query: str, stream: bool = False) -> dict:
    raise NotImplementedError
