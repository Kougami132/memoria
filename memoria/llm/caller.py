from typing import Iterator
from openai import OpenAI


class LLMCaller:
    def __init__(self, base_url: str, api_key: str, model: str) -> None:
        self._client = OpenAI(base_url=base_url, api_key=api_key)
        self._model = model

    def call(self, messages: list[dict], stream: bool = False, tools: list[dict] | None = None) -> dict | Iterator:
        if stream:
            def _gen():
                resp = self._client.chat.completions.create(
                    model=self._model, messages=messages, stream=True)
                for chunk in resp:
                    delta = chunk.choices[0].delta.content
                    if delta:
                        yield delta
            return _gen()
        kwargs = {"model": self._model, "messages": messages}
        if tools:
            kwargs["tools"] = tools
        resp = self._client.chat.completions.create(**kwargs)
        msg = resp.choices[0].message
        result = {"content": msg.content or ""}
        if getattr(msg, "tool_calls", None):
            result["tool_calls"] = [tc.model_dump() for tc in msg.tool_calls]
        return result


class MockLLMCaller:
    _RESPONSE = "[mock response]"

    def call(self, messages: list[dict], stream: bool = False, tools: list[dict] | None = None) -> dict | Iterator:
        if stream:
            return iter(self._RESPONSE)
        return {"content": self._RESPONSE}
