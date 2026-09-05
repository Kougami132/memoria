from __future__ import annotations
from memoria.connectors.crypto import decrypt_secret, encrypt_secret

import json
import re
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone

from sqlalchemy import Column, ForeignKey, Integer, String, Text, UniqueConstraint, create_engine, desc, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


class Base(DeclarativeBase):
    pass


class KnowledgeBaseRow(Base):
    __tablename__ = "knowledge_bases"
    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    description = Column(String, default="")
    type = Column(String, nullable=False, default="upload")
    created_at = Column(String, nullable=False)


class BotRow(Base):
    __tablename__ = "bots"
    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    model_key = Column(String, nullable=False, unique=True, default="")
    system_prompt = Column(String, default="")
    model_override = Column(String, default=None)
    created_at = Column(String, nullable=False)


class BotKBLink(Base):
    __tablename__ = "bot_kb_links"
    bot_id = Column(String, ForeignKey("bots.id"), primary_key=True)
    kb_id = Column(String, ForeignKey("knowledge_bases.id"), primary_key=True)


class HostRow(Base):
    __tablename__ = "hosts"
    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    host = Column(String, nullable=False)
    port = Column(Integer, nullable=False, default=22)
    username = Column(String, nullable=False, default="root")
    auth_type = Column(String, nullable=False, default="password")
    credential = Column(Text, nullable=True, default="")
    description = Column(String, default="")
    tags = Column(Text, default="[]")
    safe_mode = Column(Integer, nullable=False, default=0)
    security_mode = Column(String, nullable=False, default="read_only")
    os_info = Column(String, default="")
    status = Column(String, default="unknown")
    created_at = Column(String, nullable=False)
    updated_at = Column(String, nullable=False)


class BotHostLink(Base):
    __tablename__ = "bot_host_links"
    bot_id = Column(String, ForeignKey("bots.id"), primary_key=True)
    host_id = Column(String, ForeignKey("hosts.id"), primary_key=True)
    security_mode = Column(String, nullable=True, default=None)


class DocumentRow(Base):
    __tablename__ = "documents"
    id = Column(String, primary_key=True)
    kb_id = Column(String, ForeignKey("knowledge_bases.id"), nullable=False)
    filename = Column(String, nullable=False)
    path = Column(String, nullable=False)
    chunk_count = Column(Integer, default=0)
    source = Column(String, nullable=False, default="upload")
    created_at = Column(String, nullable=False)


class VaultRow(Base):
    __tablename__ = "vaults"
    __table_args__ = (UniqueConstraint("kb_id", name="uq_vaults_kb_id"),)
    id = Column(String, primary_key=True)
    kb_id = Column(String, ForeignKey("knowledge_bases.id"), nullable=False)
    type = Column(String, nullable=False)
    local_path = Column(String, nullable=True)
    webdav_url = Column(String, nullable=True)
    webdav_path = Column(String, nullable=True)
    webdav_username = Column(String, nullable=True)
    webdav_password = Column(String, nullable=True)
    last_synced_at = Column(String, nullable=True)
    syncing = Column(Integer, default=0)
    auto_sync = Column(Integer, default=1)
    created_at = Column(String, nullable=False)


class VaultFileRow(Base):
    __tablename__ = "vault_files"
    id = Column(String, primary_key=True)
    vault_id = Column(String, ForeignKey("vaults.id"), nullable=False)
    rel_path = Column(String, nullable=False)
    file_hash = Column(String, nullable=False)
    doc_id = Column(String, nullable=True)
    synced_at = Column(String, nullable=False)



class ApiInvocationLogRow(Base):
    __tablename__ = "api_invocation_logs"
    id = Column(String, primary_key=True)
    timestamp = Column(String, nullable=False)
    endpoint = Column(String, nullable=False)
    method = Column(String, nullable=False, default="POST")
    model = Column(String, nullable=False)
    status_code = Column(Integer, nullable=False, default=200)
    duration_ms = Column(Integer, nullable=False, default=0)
    prompt_tokens = Column(Integer, nullable=False, default=0)
    completion_tokens = Column(Integer, nullable=False, default=0)
    total_tokens = Column(Integer, nullable=False, default=0)
    session_id = Column(String, nullable=True)
    error_msg = Column(Text, nullable=True)

class QqbotLogRow(Base):
    __tablename__ = "qqbot_logs"
    id = Column(String, primary_key=True)
    timestamp = Column(String, nullable=False)
    category = Column(String, nullable=False)  # "connection" | "message"
    level = Column(String, nullable=False, default="INFO")  # "INFO" | "WARN" | "ERROR"
    event_type = Column(String, nullable=False)  # CONNECTED, DISCONNECTED, HEARTBEAT, RECONNECT, RATE_LIMIT, MSG_RECV, MSG_SENT, EXEC_ERROR
    source_type = Column(String, nullable=True)  # "c2c" | "group" | "system"
    source_id = Column(String, nullable=True)
    user_name = Column(String, nullable=True)
    summary = Column(Text, nullable=False)
    duration_ms = Column(Integer, nullable=False, default=0)
    details = Column(Text, nullable=True)

class SessionRow(Base):
    __tablename__ = "sessions"
    id = Column(String, primary_key=True)
    bot_id = Column(String, ForeignKey("bots.id"), nullable=True)
    session_type = Column(String, nullable=False, default="bot")
    title = Column(String, nullable=False, default="")
    created_at = Column(String, nullable=False)


class MessageRow(Base):
    __tablename__ = "messages"
    id = Column(String, primary_key=True)
    session_id = Column(String, ForeignKey("sessions.id"), nullable=False)
    role = Column(String, nullable=False)
    content = Column(String, nullable=False)
    status = Column(String, nullable=True, default="done")
    message_metadata = Column("metadata", Text, nullable=True)
    sources = Column(Text, nullable=True)
    created_at = Column(String, nullable=False)


class MessageTraceRow(Base):
    __tablename__ = "message_traces"
    id = Column(String, primary_key=True)
    session_id = Column(String, ForeignKey("sessions.id"), nullable=False)
    message_id = Column(String, ForeignKey("messages.id"), nullable=False)
    trace_id = Column(String, nullable=False)
    workflow_name = Column(String, nullable=True)
    group_id = Column(String, nullable=True)
    trace_metadata = Column("metadata", Text, nullable=True)
    spans = Column(Text, nullable=True)
    summary = Column(Text, nullable=True)
    created_at = Column(String, nullable=False)


class RuntimeSettingRow(Base):
    __tablename__ = "runtime_settings"
    key = Column(String, primary_key=True)
    value = Column(String, nullable=False)
    updated_at = Column(String, nullable=False)


class QQSessionMappingRow(Base):
    __tablename__ = "qq_session_mappings"
    key = Column(String, primary_key=True)
    app_id = Column(String, nullable=False)
    context_type = Column(String, nullable=False)
    context_id = Column(String, nullable=False)
    session_id = Column(String, ForeignKey("sessions.id"), nullable=False, unique=True)
    created_at = Column(String, nullable=False)
    updated_at = Column(String, nullable=False)


class QQEventRow(Base):
    __tablename__ = "qq_events"
    event_id = Column(String, primary_key=True)
    received_at = Column(String, nullable=False)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _uid() -> str:
    return str(uuid.uuid4())


BOT_MODEL_KEY_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,62}$")
LEGACY_UUID_MODEL_KEY_RE = re.compile(r"^bot-[0-9a-f]{32}$")


def _bot_model_key(name: str) -> str:
    """Create a readable key from an ASCII Bot name; non-ASCII names need an explicit key."""
    key = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    if not key or not name.isascii():
        raise ValueError("model_key is required for Bot names that cannot produce an ASCII identifier")
    return key[:63].rstrip("-")


def _validate_bot_model_key(model_key: str) -> str:
    model_key = model_key.strip().lower()
    if not BOT_MODEL_KEY_RE.fullmatch(model_key):
        raise ValueError("model_key must be 1-63 characters of lowercase ASCII letters, numbers, '_' or '-'")
    return model_key


AUTO_SESSION_TITLE_MAX_CHARS = 32
MANUAL_SESSION_TITLE_MAX_CHARS = 80
DEFAULT_SESSION_TITLE = "新对话"


def _clean_session_title(title: str | None) -> str:
    return " ".join((title or "").split())


def _truncate_title(title: str, max_chars: int) -> str:
    if len(title) <= max_chars:
        return title
    return title[: max_chars - 1].rstrip() + "…"


def _auto_session_title(message: str | None) -> str:
    title = _clean_session_title(message)
    if not title:
        return DEFAULT_SESSION_TITLE
    return _truncate_title(title, AUTO_SESSION_TITLE_MAX_CHARS)


def _manual_session_title(title: str | None) -> str:
    title = _clean_session_title(title)
    if not title:
        return DEFAULT_SESSION_TITLE
    return _truncate_title(title, MANUAL_SESSION_TITLE_MAX_CHARS)


class DB:
    def __init__(self, db_path: str) -> None:
        from sqlalchemy.pool import NullPool
        engine = create_engine(
            f"sqlite:///{db_path}",
            connect_args={"check_same_thread": False},
            poolclass=NullPool,
        )
        Base.metadata.create_all(engine)
        with engine.connect() as conn:
            kb_cols = [r[1] for r in conn.execute(text("PRAGMA table_info(knowledge_bases)"))]
            if "type" not in kb_cols:
                conn.execute(text("ALTER TABLE knowledge_bases ADD COLUMN type TEXT DEFAULT 'upload'"))
                conn.execute(text("UPDATE knowledge_bases SET type='vault' WHERE id IN (SELECT kb_id FROM vaults)"))
                conn.commit()
            msg_cols = [r[1] for r in conn.execute(text("PRAGMA table_info(messages)"))]
            if "sources" not in msg_cols:
                conn.execute(text("ALTER TABLE messages ADD COLUMN sources TEXT"))
                conn.commit()
            if "status" not in msg_cols:
                conn.execute(text("ALTER TABLE messages ADD COLUMN status TEXT DEFAULT 'done'"))
                conn.commit()
            if "metadata" not in msg_cols:
                conn.execute(text("ALTER TABLE messages ADD COLUMN metadata TEXT"))
                conn.commit()
            doc_cols = [r[1] for r in conn.execute(text("PRAGMA table_info(documents)"))]
            if "source" not in doc_cols:
                conn.execute(text("ALTER TABLE documents ADD COLUMN source TEXT DEFAULT 'upload'"))
                conn.commit()
            vault_cols = [r[1] for r in conn.execute(text("PRAGMA table_info(vaults)"))]
            if "syncing" not in vault_cols:
                conn.execute(text("ALTER TABLE vaults ADD COLUMN syncing INTEGER DEFAULT 0"))
                conn.commit()
            if "auto_sync" not in vault_cols:
                conn.execute(text("ALTER TABLE vaults ADD COLUMN auto_sync INTEGER DEFAULT 1"))
                conn.commit()
            if "webdav_path" not in vault_cols:
                conn.execute(text("ALTER TABLE vaults ADD COLUMN webdav_path TEXT DEFAULT '/'"))
                conn.commit()
            host_cols = [r[1] for r in conn.execute(text("PRAGMA table_info(hosts)"))]
            if "safe_mode" not in host_cols:
                conn.execute(text("ALTER TABLE hosts ADD COLUMN safe_mode INTEGER DEFAULT 0"))
            if "security_mode" not in host_cols:
                conn.execute(text("ALTER TABLE hosts ADD COLUMN security_mode TEXT DEFAULT 'read_only'"))
                conn.commit()
            bot_host_cols = [r[1] for r in conn.execute(text("PRAGMA table_info(bot_host_links)"))]
            if "security_mode" not in bot_host_cols:
                conn.execute(text("ALTER TABLE bot_host_links ADD COLUMN security_mode TEXT DEFAULT NULL"))
                conn.commit()
            bot_cols = [r[1] for r in conn.execute(text("PRAGMA table_info(bots)"))]
            if "model_key" not in bot_cols:
                conn.execute(text("ALTER TABLE bots ADD COLUMN model_key TEXT DEFAULT ''"))
                conn.commit()
            bot_rows = conn.execute(text(
                "SELECT id, name, model_key FROM bots "
                "WHERE model_key IS NULL OR model_key = '' OR model_key GLOB 'bot-[0-9a-f]*'"
            )).fetchall()
            for bot_row in bot_rows:
                try:
                    model_key = _bot_model_key(bot_row[1])
                except ValueError:
                    # Legacy records without an ASCII name remain addressable until renamed/configured.
                    model_key = f"legacy-{bot_row[0][:8]}"
                if bot_row[2] and not LEGACY_UUID_MODEL_KEY_RE.fullmatch(bot_row[2]):
                    continue
                base_model_key = model_key
                suffix = 2
                while conn.execute(
                    text("SELECT 1 FROM bots WHERE model_key = :model_key AND id != :bot_id"),
                    {"model_key": model_key, "bot_id": bot_row[0]},
                ).first():
                    suffix_text = f"-{suffix}"
                    model_key = f"{base_model_key[:63 - len(suffix_text)]}{suffix_text}"
                    suffix += 1
                conn.execute(
                    text("UPDATE bots SET model_key = :model_key WHERE id = :bot_id"),
                    {"model_key": model_key, "bot_id": bot_row[0]},
                )
            if bot_rows:
                conn.commit()
            conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_bots_model_key ON bots (model_key)"))
            conn.commit()
            session_info = list(conn.execute(text("PRAGMA table_info(sessions)")))
            session_cols = [r[1] for r in session_info]
            bot_id_notnull = any(r[1] == "bot_id" and r[3] == 1 for r in session_info)
            if "title" not in session_cols:
                conn.execute(text("ALTER TABLE sessions ADD COLUMN title TEXT DEFAULT ''"))
                conn.commit()
                session_info = list(conn.execute(text("PRAGMA table_info(sessions)")))
                session_cols = [r[1] for r in session_info]
            if "session_type" not in session_cols or bot_id_notnull:
                # SQLite cannot alter a column from NOT NULL to NULL in place. Rebuild
                # the small sessions table while preserving all existing bot sessions.
                conn.execute(text("PRAGMA foreign_keys=OFF"))
                conn.execute(text("ALTER TABLE sessions RENAME TO sessions_legacy"))
                SessionRow.__table__.create(conn)
                conn.execute(text(
                    "INSERT INTO sessions (id, bot_id, session_type, title, created_at) "
                    "SELECT id, bot_id, 'bot', title, created_at FROM sessions_legacy"
                ))
                conn.execute(text("DROP TABLE sessions_legacy"))
                conn.execute(text("PRAGMA foreign_keys=ON"))
                conn.commit()
            trace_fk_targets = [r[2] for r in conn.execute(text("PRAGMA foreign_key_list(message_traces)"))]
            if "sessions_legacy" in trace_fk_targets:
                # The new trace table may have been created before the legacy sessions-table
                # rebuild above; SQLite rewrites FK targets on table rename, so rebuild it
                # once more to point traces at the final sessions table.
                conn.execute(text("ALTER TABLE message_traces RENAME TO message_traces_legacy"))
                MessageTraceRow.__table__.create(conn)
                conn.execute(text(
                    "INSERT INTO message_traces "
                    "(id, session_id, message_id, trace_id, workflow_name, group_id, metadata, spans, summary, created_at) "
                    "SELECT id, session_id, message_id, trace_id, workflow_name, group_id, metadata, spans, summary, created_at "
                    "FROM message_traces_legacy"
                ))
                conn.execute(text("DROP TABLE message_traces_legacy"))
                conn.commit()
        self._Session = sessionmaker(bind=engine)
        self._backfill_missing_session_titles()

    @contextmanager
    def _s(self):
        s = self._Session()
        try:
            yield s
            s.commit()
        except Exception:
            s.rollback()
            raise
        finally:
            s.close()

    # ── Knowledge Bases ──────────────────────────────────────────────────────

    def create_kb(self, name: str, description: str = "", type: str = "upload") -> dict:
        with self._s() as s:
            row = KnowledgeBaseRow(id=_uid(), name=name, description=description, type=type, created_at=_now())
            s.add(row)
            s.flush()
            return {"id": row.id, "name": row.name, "description": row.description, "type": row.type, "created_at": row.created_at}

    def get_kb(self, kb_id: str) -> dict | None:
        with self._s() as s:
            row = s.get(KnowledgeBaseRow, kb_id)
            if row is None:
                return None
            return {"id": row.id, "name": row.name, "description": row.description, "type": row.type, "created_at": row.created_at}

    def list_kbs(self) -> list[dict]:
        with self._s() as s:
            return [{"id": r.id, "name": r.name, "description": r.description, "type": r.type, "created_at": r.created_at}
                    for r in s.query(KnowledgeBaseRow).all()]

    def update_kb(self, kb_id: str, name: str | None = None, description: str | None = None) -> dict | None:
        with self._s() as s:
            row = s.get(KnowledgeBaseRow, kb_id)
            if row is None:
                return None
            if name is not None:
                row.name = name
            if description is not None:
                row.description = description
            s.flush()
            return {"id": row.id, "name": row.name, "description": row.description, "type": row.type, "created_at": row.created_at}

    def delete_kb(self, kb_id: str) -> None:
        with self._s() as s:
            s.query(BotKBLink).filter(BotKBLink.kb_id == kb_id).delete()
            # cascade vault and vault_files
            vault = s.query(VaultRow).filter(VaultRow.kb_id == kb_id).first()
            if vault:
                s.query(VaultFileRow).filter(VaultFileRow.vault_id == vault.id).delete()
                s.delete(vault)
            s.query(DocumentRow).filter(DocumentRow.kb_id == kb_id).delete()
            row = s.get(KnowledgeBaseRow, kb_id)
            if row:
                s.delete(row)

    # ── Bots ─────────────────────────────────────────────────────────────────

    def _bot_dict(self, s: Session, row: BotRow) -> dict:
        links = s.query(BotKBLink).filter(BotKBLink.bot_id == row.id).all()
        host_links = s.query(BotHostLink).filter(BotHostLink.bot_id == row.id).all()
        host_security_modes = {
            lk.host_id: lk.security_mode
            for lk in host_links
            if lk.security_mode is not None
        }
        return {
            "id": row.id, "name": row.name, "model_key": row.model_key,
            "system_prompt": row.system_prompt,
            "model_override": row.model_override, "created_at": row.created_at,
            "kb_ids": [lk.kb_id for lk in links],
            "host_ids": [lk.host_id for lk in host_links],
            "host_security_modes": host_security_modes,
        }

    def create_bot(self, name: str, system_prompt: str = "", kb_ids: list[str] | None = None,
                   host_ids: list[str] | None = None,
                   host_security_modes: dict[str, str] | None = None,
                   model_override: str | None = None,
                   model_key: str | None = None) -> dict:
        with self._s() as s:
            if model_key is None:
                model_key = _bot_model_key(name)
                base = model_key
                suffix = 2
                while s.query(BotRow).filter(BotRow.model_key == model_key).first():
                    model_key = f"{base}-{suffix}"
                    suffix += 1
            else:
                model_key = _validate_bot_model_key(model_key)
                if s.query(BotRow).filter(BotRow.model_key == model_key).first():
                    raise ValueError(f"model_key already exists: {model_key}")
            row = BotRow(id=_uid(), name=name, system_prompt=system_prompt,
                         model_key=model_key, model_override=model_override, created_at=_now())
            s.add(row)
            for kb_id in (kb_ids or []):
                s.add(BotKBLink(bot_id=row.id, kb_id=kb_id))
            for host_id in (host_ids or []):
                mode = (host_security_modes or {}).get(host_id) if host_security_modes else None
                s.add(BotHostLink(bot_id=row.id, host_id=host_id, security_mode=mode))
            s.flush()
            return self._bot_dict(s, row)

    def get_bot(self, bot_id: str) -> dict | None:
        with self._s() as s:
            row = s.get(BotRow, bot_id)
            if row is None:
                return None
            return self._bot_dict(s, row)

    def list_bots(self) -> list[dict]:
        with self._s() as s:
            return [self._bot_dict(s, r) for r in s.query(BotRow).all()]

    def resolve_bot_model(self, model: str) -> dict | None:
        if not model:
            return None
        canonical_key = model[4:] if model.startswith("bot:") else model
        with self._s() as s:
            row = s.query(BotRow).filter(BotRow.model_key == canonical_key).first()
            if row is None:
                name_matches = s.query(BotRow).filter(BotRow.name == model).all()
                if len(name_matches) == 1:
                    row = name_matches[0]
            if row is None:
                legacy_id = canonical_key
                row = s.get(BotRow, legacy_id)
            return self._bot_dict(s, row) if row else None

    def update_bot(self, bot_id: str, name: str | None = None, system_prompt: str | None = None,
                   kb_ids: list[str] | None = None, host_ids: list[str] | None = None,
                   host_security_modes: dict[str, str] | None = None,
                   model_override: str | None = None,
                   model_key: str | None = None) -> dict | None:
        with self._s() as s:
            row = s.get(BotRow, bot_id)
            if row is None:
                return None
            if name is not None:
                row.name = name
            if model_key is not None and model_key != row.model_key:
                model_key = _validate_bot_model_key(model_key)
                if s.query(BotRow).filter(BotRow.model_key == model_key, BotRow.id != bot_id).first():
                    raise ValueError(f"model_key already exists: {model_key}")
                row.model_key = model_key
            if system_prompt is not None:
                row.system_prompt = system_prompt
            if model_override is not None:
                row.model_override = model_override
            if kb_ids is not None:
                s.query(BotKBLink).filter(BotKBLink.bot_id == bot_id).delete()
                for kb_id in kb_ids:
                    s.add(BotKBLink(bot_id=bot_id, kb_id=kb_id))
            if host_ids is not None:
                s.query(BotHostLink).filter(BotHostLink.bot_id == bot_id).delete()
                for host_id in host_ids:
                    mode = (host_security_modes or {}).get(host_id) if host_security_modes else None
                    s.add(BotHostLink(bot_id=bot_id, host_id=host_id, security_mode=mode))
            elif host_security_modes is not None:
                for lk in s.query(BotHostLink).filter(BotHostLink.bot_id == bot_id).all():
                    if lk.host_id in host_security_modes:
                        lk.security_mode = host_security_modes[lk.host_id]
            s.flush()
            return self._bot_dict(s, row)

    def delete_bot(self, bot_id: str) -> None:
        with self._s() as s:
            session_ids = [r.id for r in s.query(SessionRow).filter(SessionRow.bot_id == bot_id).all()]
            if session_ids:
                s.query(MessageTraceRow).filter(MessageTraceRow.session_id.in_(session_ids)).delete(synchronize_session=False)
                s.query(MessageRow).filter(MessageRow.session_id.in_(session_ids)).delete(synchronize_session=False)
            s.query(SessionRow).filter(SessionRow.bot_id == bot_id).delete()
            s.query(BotKBLink).filter(BotKBLink.bot_id == bot_id).delete()
            s.query(BotHostLink).filter(BotHostLink.bot_id == bot_id).delete()
            row = s.get(BotRow, bot_id)
            if row:
                s.delete(row)

    # ------------------------------------------------------------------
    # Host Management
    # ------------------------------------------------------------------

    def _host_dict(self, row: HostRow, decrypt: bool = True) -> dict:
        try:
            tags = json.loads(row.tags) if row.tags else []
        except Exception:
            tags = []
        cred = row.credential or ""
        if cred and decrypt:
            cred = decrypt_secret(cred) or ""
        return {
            "id": row.id,
            "name": row.name,
            "host": row.host,
            "port": row.port,
            "username": row.username,
            "auth_type": row.auth_type,
            "credential": cred,
            "description": row.description or "",
            "tags": tags,
            "safe_mode": bool(row.safe_mode),
            "security_mode": getattr(row, "security_mode", None) or ("read_only" if row.safe_mode else "ask_confirmation"),
            "os_info": row.os_info or "",
            "status": row.status or "unknown",
            "created_at": row.created_at,
            "updated_at": row.updated_at,
        }

    def create_host(
        self,
        name: str,
        host: str,
        port: int = 22,
        username: str = "root",
        auth_type: str = "password",
        credential: str = "",
        description: str = "",
        tags: list[str] | None = None,
        safe_mode: bool = False,
        security_mode: str | None = None,
        host_id: str | None = None,
    ) -> dict:
        hid = host_id or _uid()
        now = _now()
        tags_json = json.dumps(tags or [], ensure_ascii=False)
        encrypted_cred = encrypt_secret(credential) if credential else ""
        with self._s() as s:
            row = HostRow(
                id=hid,
                name=name,
                host=host,
                port=port,
                username=username,
                auth_type=auth_type,
                credential=encrypted_cred,
                description=description,
                tags=tags_json,
                safe_mode=1 if safe_mode else 0,
                security_mode=security_mode or ("read_only" if safe_mode else "ask_confirmation"),
                os_info="",
                status="unknown",
                created_at=now,
                updated_at=now,
            )
            s.add(row)
            s.flush()
            return self._host_dict(row, decrypt=True)

    def get_host(self, host_id: str, decrypt: bool = True) -> dict | None:
        with self._s() as s:
            row = s.get(HostRow, host_id)
            if row is None:
                return None
            return self._host_dict(row, decrypt=decrypt)

    def list_hosts(self, decrypt: bool = False) -> list[dict]:
        with self._s() as s:
            rows = s.query(HostRow).order_by(desc(HostRow.created_at)).all()
            return [self._host_dict(r, decrypt=decrypt) for r in rows]

    def update_host(
        self,
        host_id: str,
        name: str | None = None,
        host: str | None = None,
        port: int | None = None,
        username: str | None = None,
        auth_type: str | None = None,
        credential: str | None = None,
        description: str | None = None,
        tags: list[str] | None = None,
        safe_mode: bool | None = None,
        security_mode: str | None = None,
        os_info: str | None = None,
        status: str | None = None,
    ) -> dict | None:
        with self._s() as s:
            row = s.get(HostRow, host_id)
            if row is None:
                return None
            if name is not None:
                row.name = name
            if host is not None:
                row.host = host
            if port is not None:
                row.port = port
            if username is not None:
                row.username = username
            if auth_type is not None:
                row.auth_type = auth_type
            if credential is not None:
                row.credential = encrypt_secret(credential) if credential else ""
            if description is not None:
                row.description = description
            if tags is not None:
                row.tags = json.dumps(tags, ensure_ascii=False)
            if safe_mode is not None:
                row.safe_mode = 1 if safe_mode else 0
            if security_mode is not None:
                row.security_mode = security_mode
                row.safe_mode = 1 if security_mode == "read_only" else 0
            if os_info is not None:
                row.os_info = os_info
            if status is not None:
                row.status = status
            row.updated_at = _now()
            s.flush()
            return self._host_dict(row, decrypt=True)

    def delete_host(self, host_id: str) -> bool:
        with self._s() as s:
            row = s.get(HostRow, host_id)
            if row is None:
                return False
            s.query(BotHostLink).filter(BotHostLink.host_id == host_id).delete()
            s.delete(row)
            return True

    # ── Documents ────────────────────────────────────────────────────────────

    def create_doc(self, kb_id: str, filename: str, path: str, chunk_count: int, source: str = "upload") -> dict:
        with self._s() as s:
            row = DocumentRow(id=_uid(), kb_id=kb_id, filename=filename,
                              path=path, chunk_count=chunk_count, source=source, created_at=_now())
            s.add(row)
            s.flush()
            return {"id": row.id, "kb_id": row.kb_id, "filename": row.filename,
                    "path": row.path, "chunk_count": row.chunk_count,
                    "source": row.source, "created_at": row.created_at}

    def get_doc(self, doc_id: str) -> dict | None:
        with self._s() as s:
            row = s.get(DocumentRow, doc_id)
            if row is None:
                return None
            return {"id": row.id, "kb_id": row.kb_id, "filename": row.filename,
                    "path": row.path, "chunk_count": row.chunk_count,
                    "source": row.source, "created_at": row.created_at}

    def list_docs(self, kb_id: str) -> list[dict]:
        with self._s() as s:
            return [{"id": r.id, "kb_id": r.kb_id, "filename": r.filename,
                     "path": r.path, "chunk_count": r.chunk_count,
                     "source": r.source, "created_at": r.created_at}
                    for r in s.query(DocumentRow).filter(DocumentRow.kb_id == kb_id).all()]

    def delete_doc(self, doc_id: str) -> None:
        with self._s() as s:
            row = s.get(DocumentRow, doc_id)
            if row:
                s.delete(row)

    # ── Sessions & Messages ──────────────────────────────────────────────────

    def _session_dict(self, r: SessionRow) -> dict:
        return {
            "id": r.id, "bot_id": r.bot_id,
            "session_type": r.session_type or "bot",
            "title": r.title or DEFAULT_SESSION_TITLE,
            "created_at": r.created_at,
        }

    def _backfill_missing_session_titles(self) -> None:
        with self._s() as s:
            rows = (s.query(SessionRow)
                    .filter(SessionRow.title.is_(None) | (SessionRow.title == ""))
                    .all())
            for row in rows:
                first_user_msg = (s.query(MessageRow)
                                  .filter(MessageRow.session_id == row.id, MessageRow.role == "user")
                                  .order_by(MessageRow.created_at)
                                  .first())
                row.title = _auto_session_title(first_user_msg.content if first_user_msg else None)

    def create_session(self, bot_id: str, title: str | None = None) -> dict:
        with self._s() as s:
            row = SessionRow(id=_uid(), bot_id=bot_id, session_type="bot",
                             title=_auto_session_title(title), created_at=_now())
            s.add(row)
            s.flush()
            return self._session_dict(row)

    def create_agentic_session(self, title: str | None = None) -> dict:
        with self._s() as s:
            row = SessionRow(id=_uid(), bot_id=None, session_type="agentic",
                             title=_auto_session_title(title), created_at=_now())
            s.add(row)
            s.flush()
            return self._session_dict(row)

    def get_session(self, session_id: str) -> dict | None:
        with self._s() as s:
            row = s.get(SessionRow, session_id)
            if row is None:
                return None
            return self._session_dict(row)

    def get_bot_session(self, session_id: str, bot_id: str) -> dict | None:
        with self._s() as s:
            row = (s.query(SessionRow)
                   .filter(SessionRow.id == session_id,
                           SessionRow.bot_id == bot_id,
                           SessionRow.session_type == "bot")
                   .first())
            return self._session_dict(row) if row else None

    def get_agentic_session(self, session_id: str) -> dict | None:
        with self._s() as s:
            row = (s.query(SessionRow)
                   .filter(SessionRow.id == session_id,
                           SessionRow.session_type == "agentic")
                   .first())
            return self._session_dict(row) if row else None

    def update_session_title(self, session_id: str, title: str) -> dict | None:
        with self._s() as s:
            row = s.get(SessionRow, session_id)
            if row is None:
                return None
            row.title = _manual_session_title(title)
            s.flush()
            return self._session_dict(row)

    def update_agentic_session_title(self, session_id: str, title: str) -> dict | None:
        with self._s() as s:
            row = (s.query(SessionRow)
                   .filter(SessionRow.id == session_id,
                           SessionRow.session_type == "agentic")
                   .first())
            if row is None:
                return None
            row.title = _manual_session_title(title)
            s.flush()
            return self._session_dict(row)

    def _trace_dict(self, r: MessageTraceRow) -> dict:
        return {
            "id": r.id,
            "session_id": r.session_id,
            "message_id": r.message_id,
            "trace_id": r.trace_id,
            "workflow_name": r.workflow_name,
            "group_id": r.group_id,
            "metadata": json.loads(r.trace_metadata) if r.trace_metadata else {},
            "spans": json.loads(r.spans) if r.spans else [],
            "summary": json.loads(r.summary) if r.summary else {},
            "created_at": r.created_at,
        }

    def _msg_dict(self, r: MessageRow, trace: dict | None = None) -> dict:
        meta = None
        if getattr(r, "message_metadata", None):
            try:
                meta = json.loads(r.message_metadata)
            except Exception:
                meta = None
        return {
            "id": r.id, "session_id": r.session_id, "role": r.role,
            "content": r.content, "created_at": r.created_at,
            "status": getattr(r, "status", None) or "done",
            "metadata": meta,
            "sources": json.loads(r.sources) if r.sources else [],
            "trace": trace,
        }

    def get_messages(self, session_id: str, limit: int = 10) -> list[dict]:
        with self._s() as s:
            rows = (s.query(MessageRow)
                    .filter(MessageRow.session_id == session_id)
                    .order_by(desc(MessageRow.created_at))
                    .limit(limit)
                    .all())
            return [self._msg_dict(r) for r in reversed(rows)]

    def add_message(
        self,
        session_id: str,
        role: str,
        content: str,
        sources: list | None = None,
        status: str = "done",
        metadata: dict | None = None,
    ) -> dict:
        with self._s() as s:
            row = MessageRow(
                id=_uid(),
                session_id=session_id,
                role=role,
                content=content,
                status=status,
                message_metadata=json.dumps(metadata, ensure_ascii=False) if metadata else None,
                sources=json.dumps(sources, ensure_ascii=False) if sources else None,
                created_at=_now(),
            )
            s.add(row)
            s.flush()
            return self._msg_dict(row)

    def add_message_trace(self, session_id: str, message_id: str, trace: dict) -> dict:
        with self._s() as s:
            row = MessageTraceRow(
                id=_uid(),
                session_id=session_id,
                message_id=message_id,
                trace_id=trace.get("trace_id") or _uid(),
                workflow_name=trace.get("workflow_name"),
                group_id=trace.get("group_id"),
                trace_metadata=json.dumps(trace.get("metadata") or {}, ensure_ascii=False, default=str),
                spans=json.dumps(trace.get("spans") or [], ensure_ascii=False, default=str),
                summary=json.dumps(trace.get("summary") or {}, ensure_ascii=False, default=str),
                created_at=_now(),
            )
            s.add(row)
            s.flush()
            return self._trace_dict(row)

    def update_message_status(
        self,
        message_id: str,
        status: str,
        metadata: dict | None = None,
        content: str | None = None,
        sources: list | None = None,
    ) -> dict | None:
        with self._s() as s:
            row = s.query(MessageRow).filter(MessageRow.id == message_id).first()
            if not row:
                return None
            row.status = status
            if metadata is not None:
                row.message_metadata = json.dumps(metadata, ensure_ascii=False)
            if content is not None:
                row.content = content
            if sources is not None:
                row.sources = json.dumps(sources, ensure_ascii=False)
            s.flush()
            return self._msg_dict(row)

    def update_approval_message_status(self, approval_id: str, status: str) -> bool:
        with self._s() as s:
            rows = s.query(MessageRow).filter(MessageRow.status == "pending_approval").all()
            updated = False
            for r in rows:
                if r.message_metadata:
                    try:
                        meta = json.loads(r.message_metadata)
                        if meta.get("approval_id") == approval_id:
                            r.status = status
                            meta["approval_status"] = status
                            r.message_metadata = json.dumps(meta, ensure_ascii=False)
                            updated = True
                    except Exception:
                        pass
            return updated

    # -- Runtime Settings ---------------------------------------------------

    def get_setting(self, key: str) -> str | None:
        with self._s() as s:
            row = s.get(RuntimeSettingRow, key)
            return row.value if row else None

    def set_setting(self, key: str, value: str) -> None:
        with self._s() as s:
            row = s.get(RuntimeSettingRow, key)
            if row:
                row.value = value
                row.updated_at = _now()
            else:
                s.add(RuntimeSettingRow(key=key, value=value, updated_at=_now()))

    def delete_setting(self, key: str) -> None:
        with self._s() as s:
            row = s.get(RuntimeSettingRow, key)
            if row:
                s.delete(row)

    def get_all_settings(self) -> dict[str, str]:
        with self._s() as s:
            return {r.key: r.value for r in s.query(RuntimeSettingRow).all()}

    # -- QQ Bot -------------------------------------------------------------

    def get_or_create_qq_session(
        self,
        app_id: str,
        context_type: str,
        context_id: str,
        title: str | None = None,
    ) -> dict:
        key = f"{app_id}:{context_type}:{context_id}"
        with self._s() as s:
            row = s.get(QQSessionMappingRow, key)
            if row:
                session = s.get(SessionRow, row.session_id)
                if session:
                    row.updated_at = _now()
                    return self._session_dict(session)

            session = SessionRow(
                id=_uid(), bot_id=None, session_type="agentic",
                title=_auto_session_title(title), created_at=_now(),
            )
            s.add(session)
            s.flush()
            mapping = QQSessionMappingRow(
                key=key, app_id=app_id, context_type=context_type,
                context_id=context_id, session_id=session.id,
                created_at=_now(), updated_at=_now(),
            )
            s.add(mapping)
            try:
                s.flush()
            except IntegrityError:
                # Another gateway worker may have created the same mapping.
                s.rollback()
                existing = s.get(QQSessionMappingRow, key)
                if not existing:
                    raise
                session = s.get(SessionRow, existing.session_id)
                if not session:
                    raise RuntimeError("QQ session mapping points to a missing session")
                existing.updated_at = _now()
                return self._session_dict(session)
            return self._session_dict(session)

    def claim_qq_event(self, event_id: str) -> bool:
        if not event_id:
            return False
        with self._s() as s:
            s.add(QQEventRow(event_id=event_id, received_at=_now()))
            try:
                s.flush()
            except IntegrityError:
                s.rollback()
                return False
            return True

    def list_sessions(self, bot_id: str) -> list[dict]:
        with self._s() as s:
            rows = (s.query(SessionRow)
                    .filter(SessionRow.bot_id == bot_id, SessionRow.session_type == "bot")
                    .order_by(desc(SessionRow.created_at))
                    .all())
            return [self._session_dict(r) for r in rows]

    def list_agentic_sessions(self) -> list[dict]:
        with self._s() as s:
            rows = (s.query(SessionRow)
                    .filter(SessionRow.session_type == "agentic")
                    .order_by(desc(SessionRow.created_at))
                    .all())
            return [self._session_dict(r) for r in rows]

    def get_messages_all(self, session_id: str) -> list[dict]:
        with self._s() as s:
            rows = (s.query(MessageRow)
                    .filter(MessageRow.session_id == session_id)
                    .order_by(MessageRow.created_at)
                    .all())
            message_ids = [r.id for r in rows]
            traces = {}
            if message_ids:
                trace_rows = (s.query(MessageTraceRow)
                              .filter(MessageTraceRow.message_id.in_(message_ids))
                              .all())
                traces = {r.message_id: self._trace_dict(r) for r in trace_rows}
            return [self._msg_dict(r, trace=traces.get(r.id)) for r in rows]

    def get_message_trace(self, message_id: str) -> dict | None:
        with self._s() as s:
            row = (s.query(MessageTraceRow)
                   .filter(MessageTraceRow.message_id == message_id)
                   .first())
            return self._trace_dict(row) if row else None

    def truncate_messages_from(self, session_id: str, message_id: str, inclusive: bool = True) -> int:
        with self._s() as s:
            rows = (s.query(MessageRow)
                    .filter(MessageRow.session_id == session_id)
                    .order_by(MessageRow.created_at)
                    .all())
            ids = [r.id for r in rows]
            if message_id not in ids:
                return 0
            idx = ids.index(message_id)
            target_ids = ids[idx:] if inclusive else ids[idx + 1:]
            if not target_ids:
                return 0
            s.query(MessageTraceRow).filter(MessageTraceRow.message_id.in_(target_ids)).delete(synchronize_session=False)
            deleted_count = s.query(MessageRow).filter(MessageRow.id.in_(target_ids)).delete(synchronize_session=False)
            return deleted_count

    def delete_session(self, session_id: str) -> None:
        with self._s() as s:
            s.query(MessageTraceRow).filter(MessageTraceRow.session_id == session_id).delete(synchronize_session=False)
            s.query(MessageRow).filter(MessageRow.session_id == session_id).delete(synchronize_session=False)
            row = s.get(SessionRow, session_id)
            if row:
                s.delete(row)

    # ── Vaults ───────────────────────────────────────────────────────────────

    def _vault_dict(self, row: VaultRow) -> dict:
        return {
            "id": row.id, "kb_id": row.kb_id, "type": row.type,
            "local_path": row.local_path, "webdav_url": row.webdav_url,
            "webdav_path": row.webdav_path,
            "webdav_username": row.webdav_username, "webdav_password": row.webdav_password,
            "last_synced_at": row.last_synced_at, "syncing": bool(row.syncing),
            "auto_sync": bool(row.auto_sync),
            "created_at": row.created_at,
        }

    def create_vault(self, kb_id: str, type: str, **kwargs) -> dict:
        with self._s() as s:
            row = VaultRow(
                id=_uid(), kb_id=kb_id, type=type,
                local_path=kwargs.get("local_path"),
                webdav_url=kwargs.get("webdav_url"),
                webdav_path=kwargs.get("webdav_path"),
                webdav_username=kwargs.get("webdav_username"),
                webdav_password=kwargs.get("webdav_password"),
                created_at=_now(),
            )
            s.add(row)
            s.flush()
            return self._vault_dict(row)

    def get_vault_by_kb(self, kb_id: str) -> dict | None:
        with self._s() as s:
            row = s.query(VaultRow).filter(VaultRow.kb_id == kb_id).first()
            return self._vault_dict(row) if row else None

    def get_vault(self, vault_id: str) -> dict | None:
        with self._s() as s:
            row = s.get(VaultRow, vault_id)
            return self._vault_dict(row) if row else None

    def list_vaults(self) -> list[dict]:
        with self._s() as s:
            return [self._vault_dict(r) for r in s.query(VaultRow).all()]

    def delete_vault(self, vault_id: str) -> None:
        with self._s() as s:
            s.query(VaultFileRow).filter(VaultFileRow.vault_id == vault_id).delete()
            row = s.get(VaultRow, vault_id)
            if row:
                s.delete(row)

    def update_vault_last_synced(self, vault_id: str, ts: str) -> None:
        with self._s() as s:
            row = s.get(VaultRow, vault_id)
            if row:
                row.last_synced_at = ts

    def set_vault_syncing(self, vault_id: str, syncing: bool) -> None:
        with self._s() as s:
            row = s.get(VaultRow, vault_id)
            if row:
                row.syncing = int(syncing)

    def update_vault_auto_sync(self, vault_id: str, auto_sync: bool) -> None:
        with self._s() as s:
            row = s.get(VaultRow, vault_id)
            if row:
                row.auto_sync = int(auto_sync)

    # ── Vault Files ──────────────────────────────────────────────────────────

    def _vf_dict(self, row: VaultFileRow) -> dict:
        return {
            "id": row.id, "vault_id": row.vault_id, "rel_path": row.rel_path,
            "file_hash": row.file_hash, "doc_id": row.doc_id, "synced_at": row.synced_at,
        }

    def upsert_vault_file(self, vault_id: str, rel_path: str, file_hash: str, doc_id: str | None) -> dict:
        with self._s() as s:
            row = (s.query(VaultFileRow)
                   .filter(VaultFileRow.vault_id == vault_id, VaultFileRow.rel_path == rel_path)
                   .first())
            if row:
                row.file_hash = file_hash
                row.doc_id = doc_id
                row.synced_at = _now()
            else:
                row = VaultFileRow(id=_uid(), vault_id=vault_id, rel_path=rel_path,
                                   file_hash=file_hash, doc_id=doc_id, synced_at=_now())
                s.add(row)
            s.flush()
            return self._vf_dict(row)

    def list_vault_files(self, vault_id: str) -> list[dict]:
        with self._s() as s:
            return [self._vf_dict(r)
                    for r in s.query(VaultFileRow).filter(VaultFileRow.vault_id == vault_id).all()]

    def delete_vault_file(self, vault_file_id: str) -> None:
        with self._s() as s:
            row = s.get(VaultFileRow, vault_file_id)
            if row:
                s.delete(row)

    # ------------------------------------------------------------------
    # API Invocation Logs
    # ------------------------------------------------------------------

    def log_api_invocation(
        self,
        endpoint: str,
        method: str,
        model: str,
        status_code: int,
        duration_ms: int,
        prompt_tokens: int = 0,
        completion_tokens: int = 0,
        total_tokens: int = 0,
        session_id: str | None = None,
        error_msg: str | None = None,
    ) -> dict:
        log_id = f"log-{uuid.uuid4().hex[:12]}"
        now = datetime.now(timezone.utc).isoformat()
        row = ApiInvocationLogRow(
            id=log_id,
            timestamp=now,
            endpoint=endpoint,
            method=method,
            model=model,
            status_code=status_code,
            duration_ms=duration_ms,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            session_id=session_id,
            error_msg=error_msg,
        )
        with self._s() as s:
            s.add(row)
            s.flush()
            return {
                "id": row.id,
                "timestamp": row.timestamp,
                "endpoint": row.endpoint,
                "method": row.method,
                "model": row.model,
                "status_code": row.status_code,
                "duration_ms": row.duration_ms,
                "prompt_tokens": row.prompt_tokens,
                "completion_tokens": row.completion_tokens,
                "total_tokens": row.total_tokens,
                "session_id": row.session_id,
                "error_msg": row.error_msg,
            }

    def list_api_invocations(self, limit: int = 100, offset: int = 0) -> list[dict]:
        with self._s() as s:
            rows = (
                s.query(ApiInvocationLogRow)
                .order_by(desc(ApiInvocationLogRow.timestamp))
                .offset(offset)
                .limit(limit)
                .all()
            )
            return [
                {
                    "id": r.id,
                    "timestamp": r.timestamp,
                    "endpoint": r.endpoint,
                    "method": r.method,
                    "model": r.model,
                    "status_code": r.status_code,
                    "duration_ms": r.duration_ms,
                    "prompt_tokens": r.prompt_tokens,
                    "completion_tokens": r.completion_tokens,
                    "total_tokens": r.total_tokens,
                    "session_id": r.session_id,
                    "error_msg": r.error_msg,
                }
                for r in rows
            ]

    def clear_api_invocations(self) -> int:
        with self._s() as s:
            count = s.query(ApiInvocationLogRow).delete()
            return count

    # ------------------------------------------------------------------
    # QQBot Logs & Stats
    # ------------------------------------------------------------------

    def log_qqbot_event(
        self,
        category: str,
        event_type: str,
        summary: str,
        level: str = "INFO",
        source_type: str | None = None,
        source_id: str | None = None,
        user_name: str | None = None,
        duration_ms: int = 0,
        details: str | None = None,
    ) -> dict:
        log_id = f"qqlog-{uuid.uuid4().hex[:12]}"
        now = datetime.now(timezone.utc).isoformat()
        row = QqbotLogRow(
            id=log_id,
            timestamp=now,
            category=category,
            level=level.upper(),
            event_type=event_type,
            source_type=source_type,
            source_id=source_id,
            user_name=user_name,
            summary=summary,
            duration_ms=duration_ms,
            details=details,
        )
        with self._s() as s:
            s.add(row)
        return {
            "id": log_id,
            "timestamp": now,
            "category": category,
            "level": level.upper(),
            "event_type": event_type,
            "source_type": source_type,
            "source_id": source_id,
            "user_name": user_name,
            "summary": summary,
            "duration_ms": duration_ms,
            "details": details,
        }

    def list_qqbot_logs(
        self,
        limit: int = 100,
        offset: int = 0,
        category: str | None = None,
        level: str | None = None,
    ) -> list[dict]:
        with self._s() as s:
            q = s.query(QqbotLogRow)
            if category:
                q = q.filter(QqbotLogRow.category == category)
            if level:
                q = q.filter(QqbotLogRow.level == level.upper())
            rows = (
                q.order_by(desc(QqbotLogRow.timestamp))
                .offset(offset)
                .limit(limit)
                .all()
            )
            return [
                {
                    "id": r.id,
                    "timestamp": r.timestamp,
                    "category": r.category,
                    "level": r.level,
                    "event_type": r.event_type,
                    "source_type": r.source_type,
                    "source_id": r.source_id,
                    "user_name": r.user_name,
                    "summary": r.summary,
                    "duration_ms": r.duration_ms,
                    "details": r.details,
                }
                for r in rows
            ]

    def clear_qqbot_logs(self, category: str | None = None) -> int:
        with self._s() as s:
            q = s.query(QqbotLogRow)
            if category:
                q = q.filter(QqbotLogRow.category == category)
            count = q.delete()
            return count

    def get_qqbot_stats(self) -> dict:
        with self._s() as s:
            total_events = s.query(QqbotLogRow).count()
            msg_count = s.query(QqbotLogRow).filter(QqbotLogRow.category == "message").count()
            conn_count = s.query(QqbotLogRow).filter(QqbotLogRow.category == "connection").count()
            error_count = s.query(QqbotLogRow).filter(QqbotLogRow.level == "ERROR").count()
            last_event = (
                s.query(QqbotLogRow)
                .order_by(desc(QqbotLogRow.timestamp))
                .first()
            )
            return {
                "total_events": total_events,
                "message_count": msg_count,
                "connection_count": conn_count,
                "error_count": error_count,
                "last_event_time": last_event.timestamp if last_event else None,
            }
