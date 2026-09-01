from fastapi.testclient import TestClient

from memoria.server.app import create_app
from memoria.server.deps import get_db
from memoria.storage.db import DB


def test_get_bot_session_detail(tmp_path):
    db = DB(tmp_path / "session-detail.db")
    bot = db.create_bot("bot", "helpful", [])
    session = db.create_session(bot["id"], "hello")
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db

    response = TestClient(app).get(f"/api/sessions/{session['id']}")

    assert response.status_code == 200
    assert response.json() == session


def test_get_bot_session_detail_rejects_agent_session(tmp_path):
    db = DB(tmp_path / "session-detail.db")
    session = db.create_agentic_session("hello")
    app = create_app()
    app.dependency_overrides[get_db] = lambda: db

    response = TestClient(app).get(f"/api/sessions/{session['id']}")

    assert response.status_code == 404
