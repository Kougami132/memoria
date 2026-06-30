from __future__ import annotations

import json
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone

from sqlalchemy import Column, ForeignKey, Integer, String, Text, UniqueConstraint, create_engine, desc, text
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
    system_prompt = Column(String, default="")
    model_override = Column(String, default=None)
    created_at = Column(String, nullable=False)


class BotKBLink(Base):
    __tablename__ = "bot_kb_links"
    bot_id = Column(String, ForeignKey("bots.id"), primary_key=True)
    kb_id = Column(String, ForeignKey("knowledge_bases.id"), primary_key=True)


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


class SessionRow(Base):
    __tablename__ = "sessions"
    id = Column(String, primary_key=True)
    bot_id = Column(String, ForeignKey("bots.id"), nullable=False)
    created_at = Column(String, nullable=False)


class MessageRow(Base):
    __tablename__ = "messages"
    id = Column(String, primary_key=True)
    session_id = Column(String, ForeignKey("sessions.id"), nullable=False)
    role = Column(String, nullable=False)
    content = Column(String, nullable=False)
    sources = Column(Text, nullable=True)
    created_at = Column(String, nullable=False)


class RuntimeSettingRow(Base):
    __tablename__ = "runtime_settings"
    key = Column(String, primary_key=True)
    value = Column(String, nullable=False)
    updated_at = Column(String, nullable=False)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _uid() -> str:
    return str(uuid.uuid4())


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
        self._Session = sessionmaker(bind=engine)

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
        return {
            "id": row.id, "name": row.name, "system_prompt": row.system_prompt,
            "model_override": row.model_override, "created_at": row.created_at,
            "kb_ids": [lk.kb_id for lk in links],
        }

    def create_bot(self, name: str, system_prompt: str = "", kb_ids: list[str] | None = None,
                   model_override: str | None = None) -> dict:
        with self._s() as s:
            row = BotRow(id=_uid(), name=name, system_prompt=system_prompt,
                         model_override=model_override, created_at=_now())
            s.add(row)
            for kb_id in (kb_ids or []):
                s.add(BotKBLink(bot_id=row.id, kb_id=kb_id))
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

    def update_bot(self, bot_id: str, name: str | None = None, system_prompt: str | None = None,
                   kb_ids: list[str] | None = None, model_override: str | None = None) -> dict | None:
        with self._s() as s:
            row = s.get(BotRow, bot_id)
            if row is None:
                return None
            if name is not None:
                row.name = name
            if system_prompt is not None:
                row.system_prompt = system_prompt
            if model_override is not None:
                row.model_override = model_override
            if kb_ids is not None:
                s.query(BotKBLink).filter(BotKBLink.bot_id == bot_id).delete()
                for kb_id in kb_ids:
                    s.add(BotKBLink(bot_id=bot_id, kb_id=kb_id))
            s.flush()
            return self._bot_dict(s, row)

    def delete_bot(self, bot_id: str) -> None:
        with self._s() as s:
            session_ids = [r.id for r in s.query(SessionRow).filter(SessionRow.bot_id == bot_id).all()]
            if session_ids:
                s.query(MessageRow).filter(MessageRow.session_id.in_(session_ids)).delete(synchronize_session=False)
            s.query(SessionRow).filter(SessionRow.bot_id == bot_id).delete()
            s.query(BotKBLink).filter(BotKBLink.bot_id == bot_id).delete()
            row = s.get(BotRow, bot_id)
            if row:
                s.delete(row)

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

    def create_session(self, bot_id: str) -> dict:
        with self._s() as s:
            row = SessionRow(id=_uid(), bot_id=bot_id, created_at=_now())
            s.add(row)
            s.flush()
            return {"id": row.id, "bot_id": row.bot_id, "created_at": row.created_at}

    def get_session(self, session_id: str) -> dict | None:
        with self._s() as s:
            row = s.get(SessionRow, session_id)
            if row is None:
                return None
            return {"id": row.id, "bot_id": row.bot_id, "created_at": row.created_at}

    def _msg_dict(self, r: MessageRow) -> dict:
        return {
            "id": r.id, "session_id": r.session_id, "role": r.role,
            "content": r.content, "created_at": r.created_at,
            "sources": json.loads(r.sources) if r.sources else [],
        }

    def get_messages(self, session_id: str, limit: int = 10) -> list[dict]:
        with self._s() as s:
            rows = (s.query(MessageRow)
                    .filter(MessageRow.session_id == session_id)
                    .order_by(desc(MessageRow.created_at))
                    .limit(limit)
                    .all())
            return [self._msg_dict(r) for r in reversed(rows)]

    def add_message(self, session_id: str, role: str, content: str, sources: list | None = None) -> None:
        with self._s() as s:
            s.add(MessageRow(id=_uid(), session_id=session_id, role=role,
                             content=content,
                             sources=json.dumps(sources, ensure_ascii=False) if sources else None,
                             created_at=_now()))

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

    def list_sessions(self, bot_id: str) -> list[dict]:
        with self._s() as s:
            rows = (s.query(SessionRow)
                    .filter(SessionRow.bot_id == bot_id)
                    .order_by(desc(SessionRow.created_at))
                    .all())
            return [{"id": r.id, "bot_id": r.bot_id, "created_at": r.created_at} for r in rows]

    def get_messages_all(self, session_id: str) -> list[dict]:
        with self._s() as s:
            rows = (s.query(MessageRow)
                    .filter(MessageRow.session_id == session_id)
                    .order_by(MessageRow.created_at)
                    .all())
            return [self._msg_dict(r) for r in rows]

    # ── Vaults ───────────────────────────────────────────────────────────────

    def _vault_dict(self, row: VaultRow) -> dict:
        return {
            "id": row.id, "kb_id": row.kb_id, "type": row.type,
            "local_path": row.local_path, "webdav_url": row.webdav_url,
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
        import logging
        with self._s() as s:
            row = s.get(VaultRow, vault_id)
            if row:
                row.syncing = int(syncing)
                s.flush()
        # 立即读回验证
        with self._s() as s:
            row = s.get(VaultRow, vault_id)
            actual = bool(row.syncing) if row else None
            logging.getLogger(__name__).info(
                "set_vault_syncing vault_id=%s requested=%s actual=%s", vault_id, syncing, actual
            )

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
