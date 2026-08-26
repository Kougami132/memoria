import pytest
from fastapi.testclient import TestClient
from memoria.server.app import create_app
from memoria.server.deps import get_db
from memoria.storage.db import DB

def test_truncate_routes(tmp_path):
    db_path = str(tmp_path / "test.db")
    db = DB(db_path)
    app = create_app(lifespan=None)
    def _get_test_db():
        return db
    app.dependency_overrides[get_db] = _get_test_db
    client = TestClient(app)

    # 1. Test Bot Session Truncate
    bot = db.create_bot(name="Test Bot", system_prompt="Hello")
    session = db.create_session(bot_id=bot["id"], title="Bot Session")
    s_id = session["id"]

    m1 = db.add_message(s_id, "user", "Q1")
    m2 = db.add_message(s_id, "assistant", "A1")
    m3 = db.add_message(s_id, "user", "Q2")
    m4 = db.add_message(s_id, "assistant", "A2")

    resp = client.post(f"/api/sessions/{s_id}/truncate", json={"message_id": m3["id"], "inclusive": True})
    assert resp.status_code == 200
    assert resp.json() == {"session_id": s_id, "deleted_count": 2}

    msgs = client.get(f"/api/sessions/{s_id}/messages").json()
    assert len(msgs) == 2
    assert [m["id"] for m in msgs] == [m1["id"], m2["id"]]

    # 2. Test Agentic Session Truncate
    a_session = db.create_agentic_session(title="Agentic Session")
    as_id = a_session["id"]

    am1 = db.add_message(as_id, "user", "Agent Q1")
    am2 = db.add_message(as_id, "assistant", "Agent A1")
    db.add_message_trace(as_id, am2["id"], {"trace_id": "tr1", "summary": {}, "spans": []})
    am3 = db.add_message(as_id, "user", "Agent Q2")
    am4 = db.add_message(as_id, "assistant", "Agent A2")
    db.add_message_trace(as_id, am4["id"], {"trace_id": "tr2", "summary": {}, "spans": []})

    resp = client.post(f"/api/agent-sessions/{as_id}/truncate", json={"message_id": am3["id"], "inclusive": True})
    assert resp.status_code == 200
    assert resp.json() == {"session_id": as_id, "deleted_count": 2}

    msgs = client.get(f"/api/agent-sessions/{as_id}/messages").json()
    assert len(msgs) == 2
    assert [m["id"] for m in msgs] == [am1["id"], am2["id"]]
    assert msgs[1]["trace"] is not None

    # Test 404 for non-existent session
    resp = client.post("/api/sessions/non-existent/truncate", json={"message_id": "any", "inclusive": True})
    assert resp.status_code == 404

    resp = client.post("/api/agent-sessions/non-existent/truncate", json={"message_id": "any", "inclusive": True})
    assert resp.status_code == 404
