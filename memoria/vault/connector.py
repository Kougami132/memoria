from __future__ import annotations

import os
import posixpath
import tempfile
from abc import ABC, abstractmethod

SUPPORTED_EXTS = {".md", ".txt"}


class VaultConnector(ABC):
    @abstractmethod
    def list_files(self) -> list[str]:
        """Return relative paths of all supported files. Raise on connection failure."""

    @abstractmethod
    def read_file(self, rel_path: str) -> bytes:
        """Return file content. Raise on failure."""


class LocalConnector(VaultConnector):
    def __init__(self, root: str) -> None:
        self.root = root

    def list_files(self) -> list[str]:
        if not os.path.isdir(self.root):
            raise FileNotFoundError(f"Vault path not found: {self.root}")
        result = []
        for dirpath, _, filenames in os.walk(self.root):
            for fname in filenames:
                if os.path.splitext(fname)[1].lower() in SUPPORTED_EXTS:
                    rel = os.path.relpath(os.path.join(dirpath, fname), self.root)
                    result.append(rel)
        return result

    def read_file(self, rel_path: str) -> bytes:
        full = os.path.join(self.root, rel_path)
        with open(full, "rb") as f:
            return f.read()


class WebDAVConnector(VaultConnector):
    def __init__(self, url: str, username: str, password: str) -> None:
        from webdav3.client import Client
        self._client = Client({
            "webdav_hostname": url,
            "webdav_login": username,
            "webdav_password": password,
        })

    def list_files(self) -> list[str]:
        items = self._client.list(get_info=False)
        result = []
        for item in items:
            # item may include the root "/" entry
            path = item.rstrip("/")
            if not path:
                continue
            ext = posixpath.splitext(path)[1].lower()
            if ext in SUPPORTED_EXTS:
                result.append(path.lstrip("/"))
        return result

    def read_file(self, rel_path: str) -> bytes:
        ext = posixpath.splitext(rel_path)[1]
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp_path = tmp.name
        try:
            self._client.download_sync(rel_path, tmp_path)
            with open(tmp_path, "rb") as f:
                return f.read()
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
