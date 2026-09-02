import sqlite3
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
    assert bot["model_key"] == "bot1"
    assert bot["model_key"].isascii()
    original_model_key = bot["model_key"]
    updated = db.update_bot(bot["id"], name="bot2")
    assert updated["name"] == "bot2"
    assert updated["model_key"] == original_model_key
    db.delete_bot(bot["id"])
    assert db.get_bot(bot["id"]) is None


def test_bot_model_keys_are_unique_and_resolvable(db):
    first = db.create_bot("中文助手", model_key="customer-support")
    second = db.create_bot("other")

    assert first["model_key"] == "customer-support"
    assert second["model_key"] == "other"
    assert db.resolve_bot_model(first["model_key"])["id"] == first["id"]
    with pytest.raises(ValueError, match="already exists"):
        db.create_bot("另一个助手", model_key=first["model_key"])


def test_ascii_bot_names_get_readable_collision_keys_and_custom_keys(db):
    first = db.create_bot("Support Bot")
    second = db.create_bot("Support Bot")
    custom = db.create_bot("中文助手", model_key="customer-support")
    assert first["model_key"] == "support-bot"
    assert second["model_key"] == "support-bot-2"
    assert custom["model_key"] == "customer-support"


def test_chinese_bot_names_require_custom_model_key(db):
    with pytest.raises(ValueError, match="model_key is required"):
        db.create_bot("中文助手")

    bot = db.create_bot("中文助手", model_key="support")
    with pytest.raises(ValueError, match="lowercase ASCII"):
        db.update_bot(bot["id"], model_key="客服助手")


def test_bot_model_aliases_resolve(db):
    bot = db.create_bot("Support Bot")
    assert db.resolve_bot_model(f"bot:{bot['model_key']}")["id"] == bot["id"]
    assert db.resolve_bot_model(bot["name"])["id"] == bot["id"]
    assert db.resolve_bot_model(f"bot:{bot['id']}")["id"] == bot["id"]
    assert db.resolve_bot_model(bot["id"])["id"] == bot["id"]


def test_bot_model_name_resolution_rejects_ambiguous_names(db):
    db.create_bot("重复助手", model_key="duplicate-1")
    db.create_bot("重复助手", model_key="duplicate-2")

    assert db.resolve_bot_model("重复助手") is None


def test_bot_model_key_migration_backfills_legacy_bots(tmp_path):
    db_path = tmp_path / "legacy-bots.db"
    with sqlite3.connect(db_path) as conn:
        conn.execute("""
            CREATE TABLE bots (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, system_prompt TEXT,
                model_override TEXT, created_at TEXT NOT NULL
            )
        """)
        conn.execute("""
            INSERT INTO bots (id, name, system_prompt, model_override, created_at)
            VALUES ('legacy-1', '旧助手', '', NULL, '2026-09-01T00:00:00+00:00')
        """)

    migrated = DB(str(db_path))
    bot = migrated.get_bot("legacy-1")

    assert bot["name"] == "旧助手"
    assert bot["model_key"] == "legacy-legacy-1"
    assert bot["model_key"].isascii()
    assert DB(str(db_path)).get_bot("legacy-1")["model_key"] == bot["model_key"]


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


def test_session_title_from_first_message(db):
    bot = db.create_bot("b", "", [])
    session = db.create_session(bot["id"], "  请帮我总结\nMemoria 的同步机制  ")

    assert session["title"] == "请帮我总结 Memoria 的同步机制"
    assert db.get_session(session["id"])["title"] == "请帮我总结 Memoria 的同步机制"
    assert db.list_sessions(bot["id"])[0]["title"] == "请帮我总结 Memoria 的同步机制"


def test_update_session_title(db):
    bot = db.create_bot("b", "", [])
    session = db.create_session(bot["id"], "初始问题")

    updated = db.update_session_title(session["id"], "  自定义标题  ")

    assert updated is not None
    assert updated["title"] == "自定义标题"
    assert db.get_session(session["id"])["title"] == "自定义标题"


def test_session_title_migration_backfills_from_first_user_message(tmp_path):
    db_path = tmp_path / "legacy.db"
    with sqlite3.connect(db_path) as conn:
        conn.execute("CREATE TABLE sessions (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, created_at TEXT NOT NULL)")
        conn.execute("""
            CREATE TABLE messages (
                id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL,
                content TEXT NOT NULL, created_at TEXT NOT NULL
            )
        """)
        conn.execute("INSERT INTO sessions VALUES ('s1', 'b1', '2026-08-07T00:00:00+00:00')")
        conn.execute("""
            INSERT INTO messages (id, session_id, role, content, created_at)
            VALUES ('m1', 's1', 'user', '  旧会话的第一条问题  ', '2026-08-07T00:00:01+00:00')
        """)

    db = DB(str(db_path))

    assert db.get_session("s1")["title"] == "旧会话的第一条问题"


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


# ── Vault tests ─────────────────────────────────────────────────────────────

def test_doc_has_source_field(db):
    kb = db.create_kb("kb1", "")
    doc = db.create_doc(kb["id"], "a.md", "/tmp/a.md", 3)
    assert doc["source"] == "upload"
    docs = db.list_docs(kb["id"])
    assert docs[0]["source"] == "upload"


def test_create_doc_with_vault_source(db):
    kb = db.create_kb("kb1", "")
    doc = db.create_doc(kb["id"], "a.md", "/tmp/a.md", 3, source="vault")
    assert doc["source"] == "vault"


def test_vault_crud_local(db):
    kb = db.create_kb("kb1", "")
    vault = db.create_vault(kb["id"], "local", local_path="/tmp/vault")
    assert vault["type"] == "local"
    assert vault["local_path"] == "/tmp/vault"
    assert vault["kb_id"] == kb["id"]
    assert vault["last_synced_at"] is None

    fetched = db.get_vault_by_kb(kb["id"])
    assert fetched["id"] == vault["id"]

    fetched2 = db.get_vault(vault["id"])
    assert fetched2["id"] == vault["id"]

    vaults = db.list_vaults()
    assert any(v["id"] == vault["id"] for v in vaults)


def test_vault_crud_webdav(db):
    kb = db.create_kb("kb1", "")
    vault = db.create_vault(
        kb["id"], "webdav",
        webdav_url="https://dav.example.com",
        webdav_username="user",
        webdav_password="pass",
    )
    assert vault["type"] == "webdav"
    assert vault["webdav_url"] == "https://dav.example.com"


def test_vault_duplicate_kb_raises(db):
    kb = db.create_kb("kb1", "")
    db.create_vault(kb["id"], "local", local_path="/tmp/v")
    with pytest.raises(Exception):
        db.create_vault(kb["id"], "local", local_path="/tmp/v2")


def test_vault_last_synced_update(db):
    kb = db.create_kb("kb1", "")
    vault = db.create_vault(kb["id"], "local", local_path="/tmp/v")
    db.update_vault_last_synced(vault["id"], "2026-01-01T00:00:00+00:00")
    fetched = db.get_vault(vault["id"])
    assert fetched["last_synced_at"] == "2026-01-01T00:00:00+00:00"


def test_vault_files_upsert_and_list(db):
    kb = db.create_kb("kb1", "")
    vault = db.create_vault(kb["id"], "local", local_path="/tmp/v")
    doc = db.create_doc(kb["id"], "note.md", "/tmp/v/note.md", 2)

    vf = db.upsert_vault_file(vault["id"], "note.md", "deadbeef", doc["id"])
    assert vf["rel_path"] == "note.md"
    assert vf["file_hash"] == "deadbeef"

    listing = db.list_vault_files(vault["id"])
    assert len(listing) == 1
    assert listing[0]["doc_id"] == doc["id"]

    # upsert again with new hash
    vf2 = db.upsert_vault_file(vault["id"], "note.md", "cafebabe", doc["id"])
    assert vf2["file_hash"] == "cafebabe"
    assert len(db.list_vault_files(vault["id"])) == 1


def test_vault_file_delete(db):
    kb = db.create_kb("kb1", "")
    vault = db.create_vault(kb["id"], "local", local_path="/tmp/v")
    vf = db.upsert_vault_file(vault["id"], "a.md", "aaa", None)
    db.delete_vault_file(vf["id"])
    assert db.list_vault_files(vault["id"]) == []


def test_delete_vault_cascades_vault_files(db):
    kb = db.create_kb("kb1", "")
    vault = db.create_vault(kb["id"], "local", local_path="/tmp/v")
    db.upsert_vault_file(vault["id"], "a.md", "aaa", None)
    db.delete_vault(vault["id"])
    assert db.get_vault_by_kb(kb["id"]) is None
    assert db.list_vault_files(vault["id"]) == []


def test_delete_kb_cascades_vault(db):
    kb = db.create_kb("kb1", "")
    vault = db.create_vault(kb["id"], "local", local_path="/tmp/v")
    vault_id = vault["id"]
    db.upsert_vault_file(vault_id, "a.md", "aaa", None)
    db.delete_kb(kb["id"])
    assert db.get_vault(vault_id) is None
    assert db.list_vault_files(vault_id) == []


def test_db_vault_auto_sync_default(db):
    """New vault should have auto_sync=True by default."""
    kb = db.create_kb("kb1", "")
    vault = db.create_vault(kb["id"], "local", local_path="/tmp/v")
    assert vault["auto_sync"] is True


def test_db_update_vault_auto_sync(db):
    """update_vault_auto_sync should persist False and True values."""
    kb = db.create_kb("kb1", "")
    vault = db.create_vault(kb["id"], "local", local_path="/tmp/v")
    vault_id = vault["id"]

    # Update to False
    db.update_vault_auto_sync(vault_id, False)
    fetched = db.get_vault(vault_id)
    assert fetched["auto_sync"] is False

    # Update to True
    db.update_vault_auto_sync(vault_id, True)
    fetched = db.get_vault(vault_id)
    assert fetched["auto_sync"] is True


def test_delete_session_cascades_messages(tmp_path):
    db = DB(str(tmp_path / "test.db"))
    bot = db.create_bot("b")
    session = db.create_session(bot["id"])
    db.add_message(session["id"], "user", "hello")
    assistant = db.add_message(session["id"], "assistant", "hi")
    db.add_message_trace(session["id"], assistant["id"], {
        "trace_id": "trace-1",
        "workflow_name": "workflow",
        "group_id": session["id"],
        "metadata": {"model": "test"},
        "spans": [{"id": "span-1", "type": "function", "name": "tool"}],
        "summary": {"span_count": 1, "tool_count": 1, "model_count": 0, "error_count": 0},
    })

    messages = db.get_messages_all(session["id"])
    assert messages[1]["trace"]["trace_id"] == "trace-1"
    assert messages[1]["trace"]["metadata"] == {"model": "test"}

    db.delete_session(session["id"])

    assert db.get_session(session["id"]) is None
    assert db.get_messages_all(session["id"]) == []
    assert db.get_message_trace(assistant["id"]) is None


def test_legacy_session_migration_keeps_message_trace_fk_to_sessions(tmp_path):
    db_path = tmp_path / "legacy.db"
    conn = sqlite3.connect(db_path)
    conn.execute("CREATE TABLE sessions (id TEXT PRIMARY KEY, bot_id TEXT NOT NULL, created_at TEXT NOT NULL)")
    conn.execute("INSERT INTO sessions VALUES ('session-1', 'bot-1', '2026-08-18T00:00:00+00:00')")
    conn.commit()
    conn.close()

    DB(str(db_path))

    conn = sqlite3.connect(db_path)
    fk_targets = [row[2] for row in conn.execute("PRAGMA foreign_key_list(message_traces)")]
    conn.close()
    assert "sessions" in fk_targets
    assert "sessions_legacy" not in fk_targets


def test_delete_session_nonexistent_is_noop(tmp_path):
    db = DB(str(tmp_path / "test.db"))
    # 不应抛出异常
    db.delete_session("nonexistent-id")
