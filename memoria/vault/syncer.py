from __future__ import annotations

import hashlib
import logging
import os
import tempfile
import threading
from datetime import datetime, timezone

from memoria.vault.connector import LocalConnector, VaultConnector, WebDAVConnector

logger = logging.getLogger(__name__)


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class VaultSyncer:
    def __init__(self, db, pipeline) -> None:
        self.db = db
        self.pipeline = pipeline

    def _make_connector(self, vault: dict) -> VaultConnector:
        if vault["type"] == "local":
            return LocalConnector(vault["local_path"])
        return WebDAVConnector(
            vault["webdav_url"],
            vault["webdav_username"],
            vault["webdav_password"],
            vault.get("webdav_path") or "/",
        )

    def sync(self, vault_id: str, cancel_event: threading.Event | None = None) -> bool:
        vault = self.db.get_vault(vault_id)
        connector = self._make_connector(vault)

        try:
            current = set(connector.list_files())
        except Exception:
            logger.exception("vault_sync: list_files failed vault_id=%s", vault_id)
            return False

        tracked = {f["rel_path"]: f for f in self.db.list_vault_files(vault_id)}

        new_files = current - tracked.keys()
        present_files = current & tracked.keys()
        deleted_files = tracked.keys() - current

        for rel_path in deleted_files:
            row = tracked[rel_path]
            try:
                if row["doc_id"]:
                    self._delete_doc(row["doc_id"], vault["kb_id"])
                self.db.delete_vault_file(row["id"])
            except Exception:
                logger.exception("vault_sync: failed to remove deleted file %s", rel_path)

        cancelled = False

        for rel_path in new_files:
            self._ingest_file(connector, vault, rel_path)
            if cancel_event and cancel_event.is_set():
                cancelled = True
                break

        if not cancelled:
            for rel_path in present_files:
                row = tracked[rel_path]
                try:
                    content = connector.read_file(rel_path)
                except Exception:
                    logger.warning("vault_sync: skip read error %s", rel_path)
                    continue
                new_hash = _sha256(content)
                if new_hash != row["file_hash"]:
                    try:
                        if row["doc_id"]:
                            self._delete_doc(row["doc_id"], vault["kb_id"])
                        self._ingest_file(connector, vault, rel_path, content=content)
                    except Exception:
                        logger.exception("vault_sync: failed to replace changed file %s", rel_path)
                if cancel_event and cancel_event.is_set():
                    cancelled = True
                    break

        if not cancelled:
            self.db.update_vault_last_synced(vault_id, _now())
        return not cancelled

    def _delete_doc(self, doc_id: str, kb_id: str) -> None:
        self.pipeline.delete_doc(doc_id, kb_id)

    def _ingest_file(self, connector: VaultConnector, vault: dict, rel_path: str,
                     content: bytes | None = None) -> None:
        if content is None:
            try:
                content = connector.read_file(rel_path)
            except Exception:
                logger.warning("vault_sync: skip file read error %s", rel_path)
                return

        ext = os.path.splitext(rel_path)[1]
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name
        try:
            result = self.pipeline.ingest(vault["kb_id"], rel_path, source="vault",
                                          filename=os.path.basename(rel_path),
                                          tmp_path=tmp_path)
        except ValueError as e:
            logger.warning("vault_sync: skip non-embeddable file %s: %s", rel_path, e)
            return
        except Exception:
            logger.exception("vault_sync: ingest failed %s", rel_path)
            return
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

        doc_id = result["doc"]["id"]
        self.db.upsert_vault_file(vault["id"], rel_path, _sha256(content), doc_id)
