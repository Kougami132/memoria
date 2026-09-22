import asyncio
import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from memoria.agents.sandbox import execute_tool_with_sandbox


@pytest.mark.asyncio
async def test_sandbox_with_lambda_returning_coroutine():
    async def dummy_async_tool():
        return {"status": "success", "result": [1, 2, 3]}

    # Calling execute_tool_with_sandbox with a lambda returning a coroutine
    # as done in memoria/agents/engine.py:
    res = await execute_tool_with_sandbox(
        "test_tool",
        lambda: dummy_async_tool(),
    )

    # Must return the actual result dictionary, NOT a coroutine object!
    assert not asyncio.iscoroutine(res)
    assert isinstance(res, dict)
    assert res == {"status": "success", "result": [1, 2, 3]}
    # And it must be JSON serializable
    json_str = json.dumps(res)
    assert "success" in json_str


@pytest.mark.asyncio
async def test_sandbox_with_coroutine_object_directly():
    async def dummy_async_tool():
        return {"hello": "world"}

    # Passing coroutine object directly
    res = await execute_tool_with_sandbox(
        "test_tool",
        dummy_async_tool(),
    )

    assert not asyncio.iscoroutine(res)
    assert res == {"hello": "world"}
    json.dumps(res)


def test_openai_agents_runner_stream_tool_execution(tmp_path):
    from unittest.mock import patch, MagicMock
    from memoria.agents.engine import OpenAIAgentsRunner
    from memoria.storage.db import DB

    db = DB(tmp_path / "test.db")
    session = db.create_agentic_session(title="Test Session")
    assistant_msg = db.add_message(session["id"], "assistant", "", status="streaming")

    runner = OpenAIAgentsRunner(base_url="http://fake", api_key="fake")
    tools = MagicMock()
    tools.list_knowledge_bases.return_value = [{"id": "kb1", "name": "Test KB"}]

    # Mock OpenAI client stream
    func_mock = MagicMock()
    func_mock.name = "list_knowledge_bases"
    func_mock.arguments = "{}"

    class FakeDelta:
        content = None
        reasoning_content = None
        thought = None
        reasoning = None
        tool_calls = [
            MagicMock(
                index=0,
                id="call_123",
                function=func_mock
            )
        ]

    class FakeChoice:
        delta = FakeDelta()

    class FakeChunk:
        choices = [FakeChoice()]
        usage = None

    class FakeStream:
        def __init__(self, chunks):
            self._chunks = chunks

        def __aiter__(self):
            return self

        async def __anext__(self):
            if not self._chunks:
                raise StopAsyncIteration
            return self._chunks.pop(0)

    # Second turn ends the conversation
    class FakeDelta2:
        content = "Done."
        reasoning_content = None
        thought = None
        reasoning = None
        tool_calls = None

    class FakeChoice2:
        delta = FakeDelta2()

    class FakeChunk2:
        choices = [FakeChoice2()]
        usage = None

    streams = [
        FakeStream([FakeChunk()]),
        FakeStream([FakeChunk2()]),
    ]

    mock_client = MagicMock()
    mock_client.chat.completions.create = AsyncMock(side_effect=lambda **kwargs: streams.pop(0))

    with patch("openai.AsyncOpenAI", return_value=mock_client):
        events = list(runner.run_stream(
            message="What KBs are there?",
            instructions="You are an assistant.",
            tools=tools,
            model_name="gpt-4o",
            session_id=session["id"],
            message_id=assistant_msg["id"],
            db=db,
        ))

    errors = [e for e in events if e.get("type") == "error"]
    assert not errors, f"Unexpected error events: {errors}"
    updated_msg = db.get_messages(session["id"])[0]
    assert "Object of type coroutine is not JSON serializable" not in (updated_msg.get("content") or "")


def test_openai_agents_runner_delegate_to_host_agent(tmp_path):
    from unittest.mock import patch, MagicMock
    from memoria.agents.engine import OpenAIAgentsRunner
    from memoria.storage.db import DB

    db = DB(tmp_path / "test.db")
    session = db.create_agentic_session(title="Test Host Session")
    assistant_msg = db.add_message(session["id"], "assistant", "", status="streaming")

    runner = OpenAIAgentsRunner(base_url="http://fake", api_key="fake")
    tools = MagicMock()
    tools.delegate_to_host_agent.return_value = {
        "status": "not_executed",
        "agent": "HostAgent",
        "hosts": [],
        "instruction": "查看系统状态",
    }

    host_func_mock = MagicMock()
    host_func_mock.name = "delegate_to_host_agent"
    host_func_mock.arguments = '{"instruction": "查看系统状态"}'

    class FakeDelta:
        content = None
        reasoning_content = None
        thought = None
        reasoning = None
        tool_calls = [
            MagicMock(
                index=0,
                id="call_host_1",
                function=host_func_mock
            )
        ]

    class FakeChoice:
        delta = FakeDelta()

    class FakeChunk:
        choices = [FakeChoice()]
        usage = None

    class FakeStream:
        def __init__(self, chunks):
            self._chunks = chunks

        def __aiter__(self):
            return self

        async def __anext__(self):
            if not self._chunks:
                raise StopAsyncIteration
            return self._chunks.pop(0)

    class FakeDelta2:
        content = "主机状态已查询完毕。"
        reasoning_content = None
        thought = None
        reasoning = None
        tool_calls = None

    class FakeChoice2:
        delta = FakeDelta2()

    class FakeChunk2:
        choices = [FakeChoice2()]
        usage = None

    streams = [
        FakeStream([FakeChunk()]),
        FakeStream([FakeChunk2()]),
    ]

    mock_client = MagicMock()
    mock_client.chat.completions.create = AsyncMock(side_effect=lambda **kwargs: streams.pop(0))

    with patch("openai.AsyncOpenAI", return_value=mock_client):
        events = list(runner.run_stream(
            message="请帮我查看服务器状态",
            instructions="You are an assistant.",
            tools=tools,
            model_name="gpt-4o",
            session_id=session["id"],
            message_id=assistant_msg["id"],
            db=db,
        ))

    errors = [e for e in events if e.get("type") == "error"]
    assert not errors, f"Unexpected error events: {errors}"
    updated_msg = db.get_messages(session["id"])[0]
    assert "Object of type coroutine is not JSON serializable" not in (updated_msg.get("content") or "")


def test_openai_agents_runner_delegate_to_host_agent_with_command(tmp_path):
    from unittest.mock import patch, MagicMock
    from memoria.agents.engine import OpenAIAgentsRunner
    from memoria.storage.db import DB

    db = DB(tmp_path / "test.db")
    session = db.create_agentic_session(title="Test Host Command Session")
    assistant_msg = db.add_message(session["id"], "assistant", "", status="streaming")

    # Add host in DB
    db.create_host(name="Production Host", host="192.168.1.100", host_id="host_1", security_mode="unrestricted")

    runner = OpenAIAgentsRunner(base_url="http://fake", api_key="fake")
    tools = MagicMock()
    tools.db = db
    tools.host = MagicMock()
    tools.host.db = db
    tools.host.host_security_modes = {"host_1": "unrestricted"}
    tools.run_host_command.return_value = {
        "status": "success",
        "stdout": "up 10 days",
        "exit_code": 0,
    }

    host_func_mock = MagicMock()
    host_func_mock.name = "delegate_to_host_agent"
    host_func_mock.arguments = '{"host_id": "host_1", "command": "uptime", "instruction": "查看系统负载"}'

    class FakeDelta:
        content = None
        reasoning_content = None
        thought = None
        reasoning = None
        tool_calls = [
            MagicMock(
                index=0,
                id="call_host_cmd_1",
                function=host_func_mock
            )
        ]

    class FakeChoice:
        delta = FakeDelta()

    class FakeChunk:
        choices = [FakeChoice()]
        usage = None

    class FakeStream:
        def __init__(self, chunks):
            self._chunks = chunks

        def __aiter__(self):
            return self

        async def __anext__(self):
            if not self._chunks:
                raise StopAsyncIteration
            return self._chunks.pop(0)

    class FakeDelta2:
        content = "系统正常，运行已 10 天。"
        reasoning_content = None
        thought = None
        reasoning = None
        tool_calls = None

    class FakeChoice2:
        delta = FakeDelta2()

    class FakeChunk2:
        choices = [FakeChoice2()]
        usage = None

    streams = [
        FakeStream([FakeChunk()]),
        FakeStream([FakeChunk2()]),
    ]

    mock_client = MagicMock()
    mock_client.chat.completions.create = AsyncMock(side_effect=lambda **kwargs: streams.pop(0))

    with patch("openai.AsyncOpenAI", return_value=mock_client):
        events = list(runner.run_stream(
            message="在生产机上运行 uptime",
            instructions="You are an assistant.",
            tools=tools,
            model_name="gpt-4o",
            session_id=session["id"],
            message_id=assistant_msg["id"],
            db=db,
        ))

    errors = [e for e in events if e.get("type") == "error"]
    assert not errors, f"Unexpected error events: {errors}"
    updated_msg = db.get_messages(session["id"])[0]
    assert "Object of type coroutine is not JSON serializable" not in (updated_msg.get("content") or "")



