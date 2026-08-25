import pytest
import tempfile
from unittest.mock import MagicMock
from pathlib import Path
from memoria.agents.engine import AgenticRagEngine, MockAgentRunner
from memoria.connectors.host.approval import global_host_approval_manager
from memoria.server.app import create_app
from fastapi.testclient import TestClient
from memoria.storage.db import DB


@pytest.fixture
def db():
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = Path(tmpdir) / "test.db"
        yield DB(db_path)


def test_message_status_and_metadata_persistence(db):
    session = db.create_agentic_session(title="Test Session")
    msg = db.add_message(
        session_id=session["id"],
        role="assistant",
        content="",
        status="pending_approval",
        metadata={
            "approval_id": "appr_12345",
            "host_id": "host_1",
            "host_name": "Test Host",
            "command": "apt-get update",
        },
    )
    assert msg["status"] == "pending_approval"
    assert msg["metadata"]["approval_id"] == "appr_12345"
    assert msg["metadata"]["command"] == "apt-get update"

    messages = db.get_messages_all(session["id"])
    assert len(messages) == 1
    assert messages[0]["status"] == "pending_approval"
    assert messages[0]["metadata"]["approval_id"] == "appr_12345"

    # Update approval message status
    updated = db.update_approval_message_status("appr_12345", "approved")
    assert updated is True

    messages_after = db.get_messages_all(session["id"])
    assert len(messages_after) == 1
    assert messages_after[0]["status"] == "approved"
    assert messages_after[0]["metadata"]["approval_status"] == "approved"


def test_approval_respond_endpoint_syncs_db(db):
    from memoria.server.deps import get_db
    app = create_app(lifespan=None)
    app.dependency_overrides[get_db] = lambda: db
    client = TestClient(app)

    session = db.create_agentic_session(title="Interactive Approval Session")
    approval = global_host_approval_manager.create_approval(
        host_id="host_test",
        host_name="Host Test",
        command="systemctl restart nginx",
        session_id=session["id"],
    )

    db.add_message(
        session_id=session["id"],
        role="assistant",
        content="",
        status="pending_approval",
        metadata={
            "approval_id": approval.id,
            "host_id": "host_test",
            "host_name": "Host Test",
            "command": "systemctl restart nginx",
        },
    )

    resp = client.post(
        f"/api/hosts/approvals/{approval.id}/respond",
        json={"approved": True},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "approved"

    messages = db.get_messages_all(session["id"])
    assert len(messages) == 1
    assert messages[0]["status"] == "approved"


def test_engine_run_stream_persists_on_completion(db):
    pipeline = MagicMock()
    engine = AgenticRagEngine(
        db=db,
        pipeline=pipeline,
        runner=MockAgentRunner(),
    )
    sess = db.create_agentic_session(title="Stream Test")
    events = list(engine.run_stream("hello test", session_id=sess["id"]))
    assert any(e.get("type") == "done" for e in events)

    messages = db.get_messages_all(sess["id"])
    assert len(messages) == 2
    assert messages[0]["role"] == "user"
    assert messages[0]["content"] == "hello test"
    assert messages[1]["role"] == "assistant"
    assert messages[1]["content"] == "[mock agentic response]"


def test_engine_run_stream_persists_on_interruption(db):
    class SlowStreamRunner:
        def run_stream(self, prompt, instructions, tools, model, **kwargs):
            yield {"type": "answer_delta", "delta": "Partial "}
            yield {"type": "answer_delta", "delta": "output"}

    pipeline = MagicMock()
    engine = AgenticRagEngine(
        db=db,
        pipeline=pipeline,
        runner=SlowStreamRunner(),
    )
    sess = db.create_agentic_session(title="Interrupted Stream Test")
    gen = engine.run_stream("hello interrupt", session_id=sess["id"])
    
    first_event = next(gen)
    assert first_event["type"] == "init"
    second_event = next(gen)
    assert second_event["type"] == "answer_delta"
    # Close generator simulating browser disconnect/refresh
    gen.close()

    messages = db.get_messages_all(sess["id"])
    assert len(messages) == 2
    assert messages[0]["role"] == "user"
    assert messages[1]["role"] == "assistant"
    assert messages[1]["content"] == "Partial "
