from memoria.llm.caller import MockLLMCaller


def test_mock_non_streaming():
    result = MockLLMCaller().call([{"role": "user", "content": "hi"}])
    assert result["content"] == "[mock response]"


def test_mock_streaming():
    chunks = list(MockLLMCaller().call([{"role": "user", "content": "hi"}], stream=True))
    assert "".join(chunks) == "[mock response]"
    assert len(chunks) > 1
