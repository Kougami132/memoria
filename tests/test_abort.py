import pytest
from fastapi.testclient import TestClient

from memoria.server.app import create_app
from memoria.server.deps import get_db
from memoria.storage.db import DB


@pytest.fixture
def client_and_db(tmp_path):
    db_path = str(tmp_path / "test.db")
    db = DB(db_path)
    app = create_app(lifespan=None)
    app.dependency_overrides[get_db] = lambda: db
    client = TestClient(app)
    return client, db


def test_abort_bot_session(client_and_db):
    client, db = client_and_db
    # Create bot
    bot_res = client.post("/api/bots", json={"name": "Test Bot"})
    assert bot_res.status_code == 201
    bot_id = bot_res.json()["id"]

    # Create a bot session
    sess = db.create_session(bot_id, title="Session 1")
    sess_id = sess["id"]
    db.add_message(sess_id, "user", "Hello")
    msg = db.add_message(sess_id, "assistant", "Incomplete answer", status="streaming")

    # Call abort endpoint
    res = client.post(f"/api/sessions/{sess_id}/abort")
    assert res.status_code == 200
    data = res.json()
    assert data["session_id"] == sess_id

    # Verify message status updated to interrupted
    messages = db.get_messages_all(sess_id)
    assert messages[-1]["id"] == msg["id"]
    assert messages[-1]["status"] == "interrupted"


def test_abort_agentic_session(client_and_db):
    client, db = client_and_db
    # Create an agentic session
    sess = db.create_agentic_session(title="Agentic Session 1")
    sess_id = sess["id"]
    db.add_message(sess_id, "user", "Help me")
    msg = db.add_message(sess_id, "assistant", "Thinking...", status="streaming")

    # Call abort endpoint
    res = client.post(f"/api/agent-sessions/{sess_id}/abort")
    assert res.status_code == 200
    data = res.json()
    assert data["session_id"] == sess_id

    # Verify message status updated to interrupted
    messages = db.get_messages_all(sess_id)
    assert messages[-1]["id"] == msg["id"]
    assert messages[-1]["status"] == "interrupted"


def test_abort_nonexistent_session(client_and_db):
    client, _ = client_and_db
    res1 = client.post("/api/sessions/nonexistent/abort")
    assert res1.status_code == 404

    res2 = client.post("/api/agent-sessions/nonexistent/abort")
    assert res2.status_code == 404


def test_abort_with_rollback_bot_session(client_and_db):
    client, db = client_and_db
    bot_res = client.post("/api/bots", json={"name": "Rollback Test Bot"})
    bot_id = bot_res.json()["id"]

    sess = db.create_session(bot_id, title="Rollback Session")
    sess_id = sess["id"]
    user_msg = db.add_message(sess_id, "user", "I want to abort this message")
    asst_msg = db.add_message(sess_id, "assistant", "Generating partly...", status="streaming")

    # Call abort with rollback=True
    res = client.post(f"/api/sessions/{sess_id}/abort", json={"rollback": True, "message_id": user_msg["id"]})
    assert res.status_code == 200

    # Ensure both user message and assistant message are revoked from DB
    messages = db.get_messages_all(sess_id)
    assert len(messages) == 0


def test_abort_with_rollback_agentic_session(client_and_db):
    client, db = client_and_db
    sess = db.create_agentic_session(title="Rollback Agent Session")
    sess_id = sess["id"]
    user_msg = db.add_message(sess_id, "user", "Agent please stop")
    asst_msg = db.add_message(sess_id, "assistant", "Processing...", status="streaming")

    # Call abort with rollback=True without passing explicit message_id
    res = client.post(f"/api/agent-sessions/{sess_id}/abort", json={"rollback": True})
    assert res.status_code == 200

    # Ensure last user message and subsequent assistant messages are rolled back
    messages = db.get_messages_all(sess_id)
    assert len(messages) == 0
