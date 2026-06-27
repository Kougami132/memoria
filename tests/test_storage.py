import time
import pytest
from memoria.storage.db import DB


@pytest.fixture
def db(tmp_path):
    return DB(str(tmp_path / "test.db"))


def test_kb_crud(db):
    kb = db.create_kb("my-kb", "desc")
    assert kb["name"] == "my-kb"
    assert db.get_kb(kb["id"])["id"] == kb["id"]
    assert len(db.list_kbs()) == 1
    db.delete_kb(kb["id"])
    assert db.get_kb(kb["id"]) is None


def test_bot_crud(db):
    kb = db.create_kb("kb1", "")
    bot = db.create_bot("bot1", "prompt", [kb["id"]])
    assert bot["kb_ids"] == [kb["id"]]
    updated = db.update_bot(bot["id"], name="bot2")
    assert updated["name"] == "bot2"
    db.delete_bot(bot["id"])
    assert db.get_bot(bot["id"]) is None


def test_doc_crud(db):
    kb = db.create_kb("kb1", "")
    doc = db.create_doc(kb["id"], "a.md", "/tmp/a.md", 3)
    assert doc["chunk_count"] == 3
    assert len(db.list_docs(kb["id"])) == 1
    db.delete_doc(doc["id"])
    assert db.list_docs(kb["id"]) == []


def test_session_messages(db):
    bot = db.create_bot("b", "", [])
    sess = db.create_session(bot["id"])
    db.add_message(sess["id"], "user", "hello")
    db.add_message(sess["id"], "assistant", "hi")
    msgs = db.get_messages(sess["id"])
    assert len(msgs) == 2
    assert msgs[0]["role"] == "user"


def test_get_messages_limit(db):
    bot = db.create_bot("b", "", [])
    sess = db.create_session(bot["id"])
    for i in range(15):
        db.add_message(sess["id"], "user", f"msg{i}")
    msgs = db.get_messages(sess["id"], limit=10)
    assert len(msgs) == 10


def test_runtime_settings(db):
    assert db.get_setting("top_k") is None
    db.set_setting("top_k", "10")
    assert db.get_setting("top_k") == "10"
    db.set_setting("top_k", "20")
    assert db.get_setting("top_k") == "20"
    assert db.get_all_settings() == {"top_k": "20"}


def test_list_sessions(db):
    bot = db.create_bot("b", "", [])
    s1 = db.create_session(bot["id"])
    time.sleep(0.002)
    s2 = db.create_session(bot["id"])
    sessions = db.list_sessions(bot["id"])
    assert len(sessions) == 2
    assert sessions[0]["id"] == s2["id"]  # DESC: s2 first
    assert sessions[1]["id"] == s1["id"]


def test_get_messages_all(db):
    bot = db.create_bot("b", "", [])
    sess = db.create_session(bot["id"])
    for i in range(15):
        db.add_message(sess["id"], "user", f"msg{i}")
    msgs = db.get_messages_all(sess["id"])
    assert len(msgs) == 15
    assert msgs[0]["content"] == "msg0"
    assert msgs[14]["content"] == "msg14"


def test_get_messages_all_session_not_exist(db):
    msgs = db.get_messages_all("nonexistent-id")
    assert msgs == []
