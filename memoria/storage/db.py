class DB:
    def __init__(self, db_path: str) -> None:
        raise NotImplementedError

    def get(self, id: str) -> dict | None:
        raise NotImplementedError

    def list(self) -> list[dict]:
        raise NotImplementedError

    def create(self, obj: dict) -> dict:
        raise NotImplementedError

    def delete(self, id: str) -> None:
        raise NotImplementedError
