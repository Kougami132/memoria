from __future__ import annotations

import uuid
from contextlib import contextmanager
from datetime import datetime, timezone

from sqlalchemy import Column, ForeignKey, Integer, String, create_engine, desc
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


class Base(DeclarativeBase):
    pass


class KnowledgeBaseRow(Base):
    __tablename__ = "knowledge_bases"
    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    description = Column(String, default="")
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
    created_at = Column(String, nullable=False)


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
        engine = create_engine(f"sqlite:///{db_path}", connect_args={"check_same_thread": False})
        Base.metadata.create_all(engine)
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

    def create_kb(self, name: str, description: str = "") -> dict:
        with self._s() as s:
            row = KnowledgeBaseRow(id=_uid(), name=name, description=description, created_at=_now())
            s.add(row)
            s.flush()
            return {"id": row.id, "name": row.name, "description": row.description, "created_at": row.created_at}

    def get_kb(self, kb_id: str) -> dict | None:
        with self._s() as s:
            row = s.get(KnowledgeBaseRow, kb_id)
            if row is None:
                return None
            return {"id": row.id, "name": row.name, "description": row.description, "created_at": row.created_at}

    def list_kbs(self) -> list[dict]:
        with self._s() as s:
            return [{"id": r.id, "name": r.name, "description": r.description, "created_at": r.created_at}
                    for r in s.query(KnowledgeBaseRow).all()]

    def delete_kb(self, kb_id: str) -> None:
        with self._s() as s:
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
            s.query(BotKBLink).filter(BotKBLink.bot_id == bot_id).delete()
            row = s.get(BotRow, bot_id)
            if row:
                s.delete(row)

    # ── Documents ────────────────────────────────────────────────────────────

    def create_doc(self, kb_id: str, filename: str, path: str, chunk_count: int) -> dict:
        with self._s() as s:
            row = DocumentRow(id=_uid(), kb_id=kb_id, filename=filename,
                              path=path, chunk_count=chunk_count, created_at=_now())
            s.add(row)
            s.flush()
            return {"id": row.id, "kb_id": row.kb_id, "filename": row.filename,
                    "path": row.path, "chunk_count": row.chunk_count, "created_at": row.created_at}

    def get_doc(self, doc_id: str) -> dict | None:
        with self._s() as s:
            row = s.get(DocumentRow, doc_id)
            if row is None:
                return None
            return {"id": row.id, "kb_id": row.kb_id, "filename": row.filename,
                    "path": row.path, "chunk_count": row.chunk_count, "created_at": row.created_at}

    def list_docs(self, kb_id: str) -> list[dict]:
        with self._s() as s:
            return [{"id": r.id, "kb_id": r.kb_id, "filename": r.filename,
                     "path": r.path, "chunk_count": r.chunk_count, "created_at": r.created_at}
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

    def get_messages(self, session_id: str, limit: int = 10) -> list[dict]:
        with self._s() as s:
            rows = (s.query(MessageRow)
                    .filter(MessageRow.session_id == session_id)
                    .order_by(desc(MessageRow.created_at))
                    .limit(limit)
                    .all())
            return [{"id": r.id, "session_id": r.session_id, "role": r.role,
                     "content": r.content, "created_at": r.created_at}
                    for r in reversed(rows)]

    def add_message(self, session_id: str, role: str, content: str) -> None:
        with self._s() as s:
            s.add(MessageRow(id=_uid(), session_id=session_id, role=role,
                             content=content, created_at=_now()))

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
            return [{"id": r.id, "session_id": r.session_id, "role": r.role,
                     "content": r.content, "created_at": r.created_at}
                    for r in rows]
