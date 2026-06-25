from typing import Iterator


class LLMCaller:
    def __init__(self, base_url: str, api_key: str, model: str) -> None:
        raise NotImplementedError

    def call(self, messages: list[dict], stream: bool = False) -> dict | Iterator:
        raise NotImplementedError
