import pytest
from memoria.storage.db import DB

def test_truncate_messages_from_inclusive(tmp_path):
    db = DB(str(tmp_path / "test.db"))
    session = db.create_agentic_session(title="Test Truncate")
    s_id = session["id"]

    m1 = db.add_message(s_id, "user", "Message 1")
    m2 = db.add_message(s_id, "assistant", "Answer 1")
    db.add_message_trace(s_id, m2["id"], {"trace_id": "t1", "summary": {"duration_ms": 100}, "spans": []})
    
    m3 = db.add_message(s_id, "user", "Message 2")
    m4 = db.add_message(s_id, "assistant", "Answer 2")
    db.add_message_trace(s_id, m4["id"], {"trace_id": "t2", "summary": {"duration_ms": 200}, "spans": []})

    assert len(db.get_messages_all(s_id)) == 4
    assert db.get_message_trace(m2["id"]) is not None
    assert db.get_message_trace(m4["id"]) is not None

    # Truncate inclusive from m3 (should delete m3 and m4)
    deleted = db.truncate_messages_from(s_id, m3["id"], inclusive=True)
    assert deleted == 2

    msgs = db.get_messages_all(s_id)
    assert len(msgs) == 2
    assert [m["id"] for m in msgs] == [m1["id"], m2["id"]]
    assert db.get_message_trace(m2["id"]) is not None
    assert db.get_message_trace(m4["id"]) is None

def test_truncate_messages_from_exclusive(tmp_path):
    db = DB(str(tmp_path / "test.db"))
    session = db.create_agentic_session(title="Test Truncate")
    s_id = session["id"]

    m1 = db.add_message(s_id, "user", "Message 1")
    m2 = db.add_message(s_id, "assistant", "Answer 1")
    m3 = db.add_message(s_id, "user", "Message 2")
    m4 = db.add_message(s_id, "assistant", "Answer 2")

    # Truncate exclusive from m3 (should delete only m4)
    deleted = db.truncate_messages_from(s_id, m3["id"], inclusive=False)
    assert deleted == 1

    msgs = db.get_messages_all(s_id)
    assert len(msgs) == 3
    assert [m["id"] for m in msgs] == [m1["id"], m2["id"], m3["id"]]

def test_truncate_messages_nonexistent_or_last(tmp_path):
    db = DB(str(tmp_path / "test.db"))
    session = db.create_agentic_session(title="Test Truncate")
    s_id = session["id"]

    m1 = db.add_message(s_id, "user", "Message 1")
    
    # Non-existent
    assert db.truncate_messages_from(s_id, "non-existent", inclusive=True) == 0
    # Exclusive on last message -> nothing after it
    assert db.truncate_messages_from(s_id, m1["id"], inclusive=False) == 0
