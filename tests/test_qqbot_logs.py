import pytest
from fastapi.testclient import TestClient

from memoria.storage.db import DB
from memoria.server.app import create_app
from memoria.server.deps import get_db


def test_db_qqbot_logs_category_filtering(tmp_path):
    db = DB(str(tmp_path / "test_logs.db"))

    # Insert events with different categories
    db.log_qqbot_event(
        category="connection",
        event_type="CONNECTING",
        summary="WebSocket connecting",
        level="INFO",
    )
    db.log_qqbot_event(
        category="connection",
        event_type="CONNECTED",
        summary="WebSocket connected",
        level="INFO",
    )
    db.log_qqbot_event(
        category="message",
        event_type="MSG_RECV",
        summary="User hello",
        level="INFO",
        user_name="Alice",
    )
    db.log_qqbot_event(
        category="message",
        event_type="MSG_ERROR",
        summary="Failed to invoke model",
        level="ERROR",
        details="Timeout error",
    )

    # 1. List all
    all_events = db.list_qqbot_logs()
    assert len(all_events) == 4

    # 2. Filter by connection category
    conn_events = db.list_qqbot_logs(category="connection")
    assert len(conn_events) == 2
    assert all(e["category"] == "connection" for e in conn_events)

    # 3. Case-insensitive category filter
    conn_events_upper = db.list_qqbot_logs(category="CONNECTION")
    assert len(conn_events_upper) == 2

    # 4. Filter by message category
    msg_events = db.list_qqbot_logs(category="message")
    assert len(msg_events) == 2
    assert all(e["category"] == "message" for e in msg_events)

    # 5. Filter by level
    err_events = db.list_qqbot_logs(level="error")
    assert len(err_events) == 1
    assert err_events[0]["event_type"] == "MSG_ERROR"

    # 6. Filter by both category and level
    msg_info = db.list_qqbot_logs(category="message", level="info")
    assert len(msg_info) == 1
    assert msg_info[0]["event_type"] == "MSG_RECV"

    # 7. Clear only connection logs
    db.clear_qqbot_logs(category="connection")
    remaining = db.list_qqbot_logs()
    assert len(remaining) == 2
    assert all(e["category"] == "message" for e in remaining)


def test_api_qqbot_events_category_query(tmp_path):
    db = DB(str(tmp_path / "test_api_logs.db"))
    db.log_qqbot_event(category="connection", event_type="CONNECTED", summary="conn ok")
    db.log_qqbot_event(category="message", event_type="MSG_SENT", summary="msg ok")

    app = create_app(lifespan=None)
    app.dependency_overrides[get_db] = lambda: db
    client = TestClient(app)

    # All events
    r_all = client.get("/api/logs/qqbot/events")
    assert r_all.status_code == 200
    assert len(r_all.json()["items"]) == 2

    # Category connection
    r_conn = client.get("/api/logs/qqbot/events?category=connection")
    assert r_conn.status_code == 200
    assert len(r_conn.json()["items"]) == 1
    assert r_conn.json()["items"][0]["category"] == "connection"

    # Category message
    r_msg = client.get("/api/logs/qqbot/events?category=message")
    assert r_msg.status_code == 200
    assert len(r_msg.json()["items"]) == 1
    assert r_msg.json()["items"][0]["category"] == "message"
