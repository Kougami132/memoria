import asyncio
import io
import json
import urllib.error
from datetime import UTC, datetime, timedelta

import pytest

from memoria.qqbot.adapter import QQBotAdapter
from memoria.qqbot.formatting import markdown_to_plain_text, split_markdown
from memoria.qqbot.gateway import (
    DEFAULT_GATEWAY_INTENTS,
    QQGateway,
    QQGatewayAPIError,
    QQGatewayCloseError,
    QQGatewayConfigurationError,
)
from memoria.qqbot.models import parse_message
from memoria.qqbot.policy import QQPolicy
from memoria.storage.db import DB


def test_parse_qq_messages_and_reject_incomplete_events():
    c2c = parse_message({
        "t": "C2C_MESSAGE_CREATE",
        "d": {"id": "e1", "author": {"user_openid": "u1"}, "content": " hello "},
    })
    assert c2c is not None
    assert (c2c.context_type, c2c.context_id, c2c.user_openid, c2c.content) == ("c2c", "u1", "u1", "hello")

    group = parse_message({
        "t": "GROUP_AT_MESSAGE_CREATE",
        "d": {
            "id": "e2", "group_openid": "g1",
            "author": {"member_openid": "m1"}, "content": "question",
        },
    })
    assert group is not None
    assert (group.context_type, group.context_id, group.group_member_openid) == ("group", "g1", "m1")

    assert parse_message({"t": "C2C_MESSAGE_CREATE", "d": {"id": "e3", "content": "x"}}) is None
    assert parse_message({"t": "GROUP_AT_MESSAGE_CREATE", "d": {"id": "e4", "group_openid": "g1", "author": {"member_openid": "m1"}, "content": "  "}}) is None


def test_parse_qq_message_id_from_gateway_event_envelope():
    message = parse_message({
        "op": 0,
        "t": "C2C_MESSAGE_CREATE",
        "id": "envelope-event",
        "d": {"id": "message-id", "author": {"user_openid": "u1"}, "content": "hello"},
    })

    assert message is not None
    assert message.event_id == "envelope-event"
    assert message.message_id == "message-id"


def test_qq_policy_requires_allowlist_by_default():
    policy = QQPolicy.from_settings({
        "enabled": "true", "app_id": "app", "client_secret": "secret",
        "user_allowlist": '["u1"]', "group_allowlist": '["g1"]',
    })
    assert policy.allows("c2c", "u1")
    assert not policy.allows("c2c", "u2")
    assert policy.allows("group", "member", "g1")
    assert not policy.allows("group", "member", "g2")


def test_qq_sessions_are_shared_per_context_but_not_between_contexts(tmp_path):
    db = DB(str(tmp_path / "qq.db"))
    first = db.get_or_create_qq_session("app", "c2c", "user", "first question")
    same = db.get_or_create_qq_session("app", "c2c", "user", "second question")
    group = db.get_or_create_qq_session("app", "group", "group", "group question")
    other_app = db.get_or_create_qq_session("other", "c2c", "user", "other app")

    assert first["id"] == same["id"]
    assert first["id"] != group["id"]
    assert first["id"] != other_app["id"]
    assert db.claim_qq_event("event-1")
    assert not db.claim_qq_event("event-1")


@pytest.mark.asyncio
async def test_adapter_uses_lazy_system_agent_and_preserves_context(tmp_path):
    db = DB(str(tmp_path / "qq.db"))
    db.set_setting("qq_enabled", "true")
    db.set_setting("qq_app_id", "app")
    db.set_setting("qq_user_allowlist", '["user"]')

    calls = []

    class Engine:
        def run_stream(self, prompt, *, session_id, bot_id):
            calls.append((prompt, session_id, bot_id))
            yield {"type": "done", "answer": "ok"}

    created = []

    def factory():
        created.append(True)
        return Engine()

    adapter = QQBotAdapter(db, factory)
    await adapter.start()
    assert not created

    sent = []

    async def fake_send_message(message, content):
        sent.append((message, content))

    adapter.send_message = fake_send_message
    await adapter.handle_event({
        "t": "C2C_MESSAGE_CREATE",
        "d": {"id": "event-1", "author": {"user_openid": "user"}, "content": "hello"},
    })
    await asyncio.wait_for(adapter._queues["app:c2c:user"].join(), timeout=1)
    assert created == [True]
    assert calls[0][0] == "hello"
    assert calls[0][2] is None
    assert sent[0][0].content == "hello"
    assert sent[0][1] == "ok"
    await adapter.stop()


@pytest.mark.asyncio
async def test_adapter_falls_back_to_active_message_when_reply_id_is_rejected(tmp_path, monkeypatch):
    db = DB(str(tmp_path / "qq.db"))
    db.set_setting("qq_enabled", "true")
    db.set_setting("qq_app_id", "app")
    db.set_setting("qq_user_allowlist", '["user"]')
    adapter = QQBotAdapter(db, lambda: None)

    class Gateway:
        async def fetch_token(self):
            return "token"

    adapter._gateway = Gateway()
    requests = []

    def fake_post(request):
        requests.append(json.loads(request.data))
        if len(requests) == 1:
            raise urllib.error.HTTPError(
                request.full_url, 400, "bad request", {},
                io.BytesIO(b'{"code":40034024,"message":"msg_id rejected"}'),
            )

    monkeypatch.setattr(adapter, "_post", fake_post)

    await adapter.send_target("c2c", "user", "answer", "message-id")

    assert [request["msg_type"] for request in requests] == [2, 2]
    assert [request["markdown"] for request in requests] == [
        {"content": "answer"},
        {"content": "answer"},
    ]
    assert requests[0]["msg_id"] == "message-id"
    assert "msg_id" not in requests[1]
    assert all(0 <= request["msg_seq"] <= 65535 for request in requests)


@pytest.mark.asyncio
async def test_adapter_does_not_downgrade_arbitrary_markdown_400(tmp_path, monkeypatch):
    db = DB(str(tmp_path / "qq.db"))
    adapter = QQBotAdapter(db, lambda: None)

    class Gateway:
        async def fetch_token(self):
            return "token"

    adapter._gateway = Gateway()

    def fake_post(request):
        raise urllib.error.HTTPError(
            request.full_url, 400, "bad request", {},
            io.BytesIO(b'{"code":100017,"message":"invalid payload"}'),
        )

    monkeypatch.setattr(adapter, "_post", fake_post)

    with pytest.raises(urllib.error.HTTPError):
        await adapter.send_target("c2c", "user", "answer")


def test_qq_markdown_helpers_keep_content_readable():
    content = "# 标题\n\n**重点** `code`\n\n- 一\n- 二\n\n[链接](https://example.com)"
    plain = markdown_to_plain_text(content)
    assert "标题" in plain
    assert "**" not in plain
    assert "链接 (https://example.com)" in plain
    assert split_markdown("a\nb", 2) == ["a", "b"]


def test_split_markdown_keeps_fenced_code_blocks_balanced():
    content = "说明\n\n```python\n" + "print('hello')\n" * 20 + "```\n\n结尾"
    chunks = split_markdown(content, 40)

    assert len(chunks) > 1
    assert all(len(chunk) <= 40 for chunk in chunks)
    assert all(chunk.count("```") % 2 == 0 for chunk in chunks)


def test_adapter_msg_seq_is_a_qq_compatible_integer():
    sequence = QQBotAdapter._next_msg_seq("context")

    assert isinstance(sequence, int)
    assert 0 <= sequence <= 65535


def test_approval_keyboard_matches_qq_inline_keyboard_payload():
    keyboard = QQBotAdapter._approval_keyboard("appr_123")
    buttons = keyboard["content"]["rows"][0]["buttons"]

    assert [button["id"] for button in buttons] == ["allow", "deny"]
    assert buttons[0]["action"] == {
        "type": 1,
        "data": "approve:appr_123:allow-once",
        "permission": {"type": 2},
        "click_limit": 1,
    }
    assert buttons[1]["action"]["data"] == "approve:appr_123:deny"
    assert all(button["group_id"] == "approval" for button in buttons)


@pytest.mark.asyncio
async def test_send_approval_falls_back_without_keyboard(tmp_path):
    db = DB(str(tmp_path / "qq.db"))
    adapter = QQBotAdapter(db, lambda: None)
    message = parse_message({
        "t": "C2C_MESSAGE_CREATE",
        "d": {"id": "message-id", "author": {"user_openid": "user"}, "content": "run"},
    })
    assert message is not None
    sent = []

    async def fake_send_target(context_type, context_id, content, reply_to=None, keyboard=None):
        sent.append((context_type, context_id, content, reply_to, keyboard))
        if keyboard is not None:
            raise urllib.error.HTTPError(
                "https://api.sgroup.qq.com/messages", 400, "bad request", {},
                io.BytesIO(b'{"code":40011000,"message":"request data invalid"}'),
            )

    adapter.send_target = fake_send_target

    await adapter.send_approval(message, {"approval_id": "appr_123", "command": "hostname"})

    assert len(sent) == 2
    assert sent[0][4]["content"]["rows"]
    assert sent[1][4] is None
    assert "按钮发送失败" in sent[1][2]


@pytest.mark.asyncio
async def test_interaction_accepts_resolved_button_data_and_user_id(tmp_path, monkeypatch):
    db = DB(str(tmp_path / "qq.db"))
    db.set_setting("qq_enabled", "true")
    db.set_setting("qq_app_id", "app")
    db.set_setting("qq_user_allowlist", '["user"]')
    adapter = QQBotAdapter(db, lambda: None)
    acked = []
    class Gateway:
        async def acknowledge_interaction(self, interaction_id, code=0):
            acked.append((interaction_id, code))

    adapter._gateway = Gateway()
    adapter._approval_contexts["appr_123"] = ("c2c", "user", "user")
    sent = []

    class Approval:
        status = "approved"

    class Manager:
        def respond(self, approval_id, approved):
            assert approval_id == "appr_123"
            assert approved is True
            return Approval()

    monkeypatch.setattr("memoria.connectors.host.approval.global_host_approval_manager", Manager())

    async def fake_send_target(*args, **kwargs):
        sent.append((args, kwargs))

    adapter.send_target = fake_send_target
    await adapter.handle_event({
        "t": "INTERACTION_CREATE",
        "id": "INTERACTION_CREATE:envelope-123",
        "d": {
            "id": "interaction-123",
            "data": {"resolved": {"button_data": "approve:appr_123:allow-once", "user_id": "user"}},
        },
    })

    assert acked == [("interaction-123", 0)]
    assert sent == []
    assert "appr_123" not in adapter._approval_contexts


@pytest.mark.asyncio
async def test_interaction_ack_happens_before_approval_response(tmp_path, monkeypatch):
    db = DB(str(tmp_path / "qq.db"))
    db.set_setting("qq_enabled", "true")
    db.set_setting("qq_app_id", "app")
    db.set_setting("qq_user_allowlist", '["user"]')
    adapter = QQBotAdapter(db, lambda: None)
    adapter._approval_contexts["appr_123"] = ("c2c", "user", "user")
    order = []

    class Gateway:
        async def acknowledge_interaction(self, interaction_id, code=0):
            order.append(("ack", interaction_id))

    class Approval:
        status = "approved"

    class Manager:
        def respond(self, approval_id, approved):
            order.append(("respond", approval_id))
            return Approval()

    adapter._gateway = Gateway()
    adapter.send_target = lambda *args, **kwargs: asyncio.sleep(0)
    monkeypatch.setattr("memoria.connectors.host.approval.global_host_approval_manager", Manager())

    await adapter.handle_event({
        "t": "INTERACTION_CREATE",
        "id": "INTERACTION_CREATE:envelope-123",
        "d": {
            "id": "interaction-123",
            "data": {"resolved": {"button_data": "approve:appr_123:allow-once", "user_id": "user"}},
        },
    })

    assert order == [("ack", "interaction-123"), ("respond", "appr_123")]


@pytest.mark.asyncio
async def test_interaction_ack_failure_does_not_block_business_handling(tmp_path, monkeypatch):
    db = DB(str(tmp_path / "qq.db"))
    db.set_setting("qq_enabled", "true")
    db.set_setting("qq_app_id", "app")
    db.set_setting("qq_user_allowlist", '["user"]')
    adapter = QQBotAdapter(db, lambda: None)
    adapter._approval_contexts["appr_123"] = ("c2c", "user", "user")
    handled = []

    class Gateway:
        async def acknowledge_interaction(self, interaction_id, code=0):
            raise RuntimeError("ack failed")

    class Approval:
        status = "approved"

    class Manager:
        def respond(self, approval_id, approved):
            handled.append(approval_id)
            return Approval()

    adapter._gateway = Gateway()
    adapter.send_target = lambda *args, **kwargs: asyncio.sleep(0)
    monkeypatch.setattr("memoria.connectors.host.approval.global_host_approval_manager", Manager())

    await adapter.handle_event({
        "t": "INTERACTION_CREATE",
        "id": "INTERACTION_CREATE:envelope-123",
        "d": {
            "id": "interaction-123",
            "data": {"resolved": {"button_data": "approve:appr_123:allow-once", "user_id": "user"}},
        },
    })

    assert handled == ["appr_123"]


def test_gateway_token_invalidation():
    gateway = QQGateway("app", "secret", 0, lambda event: None)
    gateway._token = "token"
    gateway._token_expires_at = object()
    gateway.invalidate_token()
    assert gateway._token is None
    assert gateway._token_expires_at is None


def test_gateway_describes_qq_api_error_response():
    assert QQGateway._describe_response({"code": 401001, "message": "invalid appid or client secret"}) == (
        "code=401001, message=invalid appid or client secret"
    )
    assert QQGateway._describe_response({}) == "unexpected response format"


def test_gateway_http_error_preserves_retry_after():
    error = urllib.error.HTTPError(
        "https://api.sgroup.qq.com/gateway",
        400,
        "rate limited",
        {"Retry-After": "12.5"},
        None,
    )
    wrapped = QQGatewayAPIError("rate limited", QQGateway._retry_after(error))
    assert wrapped.retry_after == 12.5


@pytest.mark.asyncio
async def test_gateway_acknowledges_interaction_with_qq_http_api(monkeypatch):
    gateway = QQGateway("app", "secret", 0, lambda event: None)
    gateway._token = "token"
    gateway._token_expires_at = datetime.now(UTC) + timedelta(minutes=5)
    requests = []

    class Response:
        status_code = 200
        text = ""
        headers = {}

    class Client:
        async def put(self, url, **kwargs):
            requests.append((url, kwargs))
            return Response()

        async def aclose(self):
            return None

    client = Client()
    monkeypatch.setattr(gateway, "_get_http_client", lambda: _completed(client))

    await gateway.acknowledge_interaction("interaction-123")

    url, kwargs = requests[0]
    assert url == "https://api.sgroup.qq.com/interactions/interaction-123"
    assert kwargs["headers"]["Content-Type"] == "application/json"
    assert kwargs["headers"]["Authorization"] == "QQBot token"
    assert kwargs["headers"]["User-Agent"] == "QQBot (Memoria, 1.0)"
    assert kwargs["json"] == {"code": 0}
    assert kwargs["timeout"] == 15.0


async def _completed(value):
    return value


@pytest.mark.asyncio
async def test_gateway_fetch_token_is_shared_by_concurrent_callers(monkeypatch):
    gateway = QQGateway("app", "secret", 0, lambda event: None)
    calls = 0

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def read(self):
            return b'{"access_token":"token","expires_in":7200}'

    def fake_urlopen(request, timeout):
        nonlocal calls
        calls += 1
        return Response()

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    assert await asyncio.gather(gateway.fetch_token(), gateway.fetch_token()) == ["token", "token"]
    assert calls == 1


def test_gateway_reconnect_delay_only_uses_numeric_payload():
    assert QQGateway._reconnect_delay({"op": 7, "d": 5}) == 5.0
    assert QQGateway._reconnect_delay({"op": 9, "d": True}) is None
    assert QQGateway._reconnect_delay({"op": 7, "d": None}) is None


@pytest.mark.asyncio
async def test_gateway_wait_is_interrupted_by_stop():
    gateway = QQGateway("app", "secret", 0, lambda event: None)
    waiter = asyncio.create_task(gateway._wait_before_reconnect(None, 30))
    await asyncio.sleep(0)
    await gateway.stop()
    await asyncio.wait_for(waiter, timeout=1)


@pytest.mark.asyncio
async def test_gateway_reuses_gateway_url_during_reconnect(monkeypatch):
    gateway = QQGateway("app", "secret", 0, lambda event: None)
    fetched_urls = []
    connections = 0

    async def fake_fetch_token():
        return "token"

    async def fake_fetch_gateway_url(token):
        fetched_urls.append(token)
        gateway._gateway_url = "wss://gateway.example"
        return gateway._gateway_url

    async def fake_run_connection(token, gateway_url):
        nonlocal connections
        connections += 1
        assert gateway_url == "wss://gateway.example"
        if connections == 2:
            gateway._stop.set()

    async def fake_wait(server_delay, backoff):
        return

    monkeypatch.setattr(gateway, "fetch_token", fake_fetch_token)
    monkeypatch.setattr(gateway, "fetch_gateway_url", fake_fetch_gateway_url)
    monkeypatch.setattr(gateway, "_run_connection", fake_run_connection)
    monkeypatch.setattr(gateway, "_wait_before_reconnect", fake_wait)

    await gateway.run()

    assert fetched_urls == ["token"]
    assert connections == 2


@pytest.mark.asyncio
async def test_gateway_eof_requests_reconnect_backoff(monkeypatch):
    async def on_event(event):
        return None

    gateway = QQGateway("app", "secret", 0, on_event)

    class EmptyWebSocket:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, traceback):
            return False

        async def recv(self):
            if not hasattr(self, "sent_hello"):
                self.sent_hello = True
                return '{"op": 10, "d": {"heartbeat_interval": 45000}}'
            return '{"op": 7, "d": 0}'

        async def send(self, message):
            return None

    monkeypatch.setattr(
        "memoria.qqbot.gateway.websockets.connect",
        lambda *args, **kwargs: EmptyWebSocket(),
    )

    assert await gateway._run_connection("token", "wss://gateway.example") == 0.0


@pytest.mark.asyncio
async def test_gateway_resume_marks_session_ready(monkeypatch):
    gateway = QQGateway("app", "secret", 0, lambda event: None)
    gateway._session_id = "session-1"
    received = []

    async def on_event(event):
        received.append(event.get("t"))

    gateway.on_event = on_event

    class ResumedWebSocket:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, traceback):
            return False

        async def recv(self):
            if not hasattr(self, "sent_hello"):
                self.sent_hello = True
                return '{"op": 10, "d": {"heartbeat_interval": 45000}}'
            if not hasattr(self, "sent_resumed"):
                self.sent_resumed = True
                return '{"op": 0, "s": 8, "t": "RESUMED", "d": {}}'
            return '{"op": 7, "d": 0}'

        async def send(self, message):
            return None

    monkeypatch.setattr(
        "memoria.qqbot.gateway.websockets.connect",
        lambda *args, **kwargs: ResumedWebSocket(),
    )

    assert await gateway._run_connection("token", "wss://gateway.example") == 0.0
    assert received == ["RESUMED"]


@pytest.mark.asyncio
async def test_adapter_start_is_idempotent(tmp_path, monkeypatch):
    db = DB(str(tmp_path / "qq.db"))
    db.set_setting("qq_enabled", "true")
    db.set_setting("qq_app_id", "app")
    db.set_setting("qq_client_secret", "secret")
    db.set_setting("qq_gateway_intents", "1")
    created = []

    async def fake_run(self):
        created.append(self)
        await asyncio.Event().wait()

    monkeypatch.setattr(QQGateway, "run", fake_run)
    adapter = QQBotAdapter(db, lambda: None)
    await asyncio.gather(adapter.start(), adapter.start())
    assert len(created) == 1
    await adapter.stop()


@pytest.mark.asyncio
async def test_adapter_reports_gateway_failure(tmp_path):
    db = DB(str(tmp_path / "qq.db"))
    db.set_setting("qq_enabled", "true")
    db.set_setting("qq_app_id", "app")
    db.set_setting("qq_client_secret", "secret")
    db.set_setting("qq_gateway_intents", "1")
    adapter = QQBotAdapter(db, lambda: None)
    await adapter.start()
    await adapter._handle_gateway_error(RuntimeError("QQ token API rejected the request: code=401001"))
    assert adapter.status == "error"
    assert adapter.last_error == "QQ token API rejected the request: code=401001"
    await adapter.stop()


@pytest.mark.asyncio
async def test_adapter_uses_default_gateway_intents(tmp_path, monkeypatch):
    db = DB(str(tmp_path / "qq.db"))
    db.set_setting("qq_enabled", "true")
    db.set_setting("qq_app_id", "app")
    db.set_setting("qq_client_secret", "secret")
    created = []
    running = asyncio.Event()

    async def fake_run(self):
        created.append(self)
        await running.wait()

    monkeypatch.setattr(QQGateway, "run", fake_run)
    adapter = QQBotAdapter(db, lambda: None)

    await adapter.start()
    await asyncio.sleep(0)

    assert adapter.status == "connecting"
    assert len(created) == 1
    assert created[0].intents == DEFAULT_GATEWAY_INTENTS
    running.set()
    await adapter.stop()


@pytest.mark.asyncio
async def test_gateway_uses_hermes_default_intents():
    gateway = QQGateway("app", "secret", 0, lambda event: None)

    assert gateway.intents == DEFAULT_GATEWAY_INTENTS


@pytest.mark.asyncio
async def test_gateway_invalid_session_stops_without_retry(monkeypatch):
    errors = []

    async def on_error(error):
        errors.append(error)

    gateway = QQGateway("app", "secret", DEFAULT_GATEWAY_INTENTS, lambda event: None, on_error)

    async def fake_fetch_token():
        return "token"

    async def fake_fetch_gateway_url(token):
        return "wss://gateway.example"

    monkeypatch.setattr(gateway, "fetch_token", fake_fetch_token)
    monkeypatch.setattr(gateway, "fetch_gateway_url", fake_fetch_gateway_url)

    async def fake_run_connection(token, gateway_url):
        raise QQGatewayCloseError(4013, "invalid intents")

    monkeypatch.setattr(gateway, "_run_connection", fake_run_connection)

    await gateway.run()

    assert len(errors) == 1
    assert isinstance(errors[0], QQGatewayConfigurationError)
    assert "4013 invalid intents" in str(errors[0])
    assert gateway._stop.is_set()
