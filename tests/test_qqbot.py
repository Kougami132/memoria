import asyncio

import pytest

from memoria.qqbot.adapter import QQBotAdapter
from memoria.qqbot.gateway import QQGateway
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


@pytest.mark.asyncio
async def test_adapter_reports_gateway_failure(tmp_path):
    db = DB(str(tmp_path / "qq.db"))
    db.set_setting("qq_enabled", "true")
    db.set_setting("qq_app_id", "app")
    db.set_setting("qq_client_secret", "secret")
    adapter = QQBotAdapter(db, lambda: None)
    await adapter.start()
    await adapter._handle_gateway_error(RuntimeError("QQ token API rejected the request: code=401001"))
    assert adapter.status == "error"
    assert adapter.last_error == "QQ token API rejected the request: code=401001"
    await adapter.stop()
