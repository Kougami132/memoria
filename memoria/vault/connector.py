from __future__ import annotations

import os
import posixpath
import tempfile
from urllib.parse import unquote, urlsplit
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


def _normalize_webdav_path(path: str | None) -> str:
    cleaned = (path or "/").strip() or "/"
    cleaned = cleaned.replace("\\", "/")
    if not cleaned.startswith("/"):
        cleaned = f"/{cleaned}"
    while "//" in cleaned:
        cleaned = cleaned.replace("//", "/")
    if len(cleaned) > 1:
        cleaned = cleaned.rstrip("/")
    return cleaned


def _relative_to_root(path: str, root: str) -> str:
    cleaned = unquote(path).replace("\\", "/").strip()
    if not cleaned:
        return ""
    if not cleaned.startswith("/"):
        cleaned = f"/{cleaned}"
    root = _normalize_webdav_path(root)
    if root != "/" and cleaned.startswith(f"{root}/"):
        cleaned = cleaned[len(root):]
    elif root != "/" and cleaned == root:
        cleaned = "/"
    return cleaned.strip("/")


def _join_webdav_path(root: str, rel_path: str) -> str:
    root = _normalize_webdav_path(root)
    rel = rel_path.replace("\\", "/").strip("/")
    if not rel:
        return "/"
    if root == "/":
        return f"/{rel}"
    return f"{root}/{rel}"


class WebDAVConnector(VaultConnector):
    def __init__(self, url: str, username: str | None, password: str | None, root_path: str | None = "/") -> None:
        from webdav3.client import Client

        self.root_path = _normalize_webdav_path(root_path)
        hostname_path = urlsplit(url).path.rstrip("/")
        self._href_root = _normalize_webdav_path(f"{hostname_path}{self.root_path if self.root_path != '/' else ''}")
        self._client = Client({
            "webdav_hostname": url,
            "webdav_login": username or "",
            "webdav_password": password or "",
            "webdav_root": self.root_path if self.root_path != "/" else "",
        })

    def list_files(self) -> list[str]:
        items = self._client.list(remote_path="/", get_info=True, recursive=True)
        result = []
        for item in items:
            if item.get("isdir"):
                continue
            rel_path = _relative_to_root(str(item.get("path") or item.get("name") or ""), self._href_root)
            if not rel_path:
                continue
            ext = posixpath.splitext(rel_path)[1].lower()
            if ext in SUPPORTED_EXTS:
                result.append(rel_path)
        return result

    def list_dirs(self, path: str | None = "/") -> list[str]:
        browse_path = _normalize_webdav_path(path)
        items = self._client.list(remote_path=browse_path, get_info=True)
        result = []
        for item in items:
            if not item.get("isdir"):
                continue
            rel_path = _relative_to_root(str(item.get("path") or item.get("name") or ""), self._href_root)
            if not rel_path:
                continue
            dir_path = _normalize_webdav_path(rel_path)
            if dir_path == browse_path:
                continue
            result.append(dir_path)
        return sorted(set(result), key=str.casefold)

    def read_file(self, rel_path: str) -> bytes:
        ext = posixpath.splitext(rel_path)[1]
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp_path = tmp.name
        try:
            self._client.download_sync(_join_webdav_path("/", rel_path), tmp_path)
            with open(tmp_path, "rb") as f:
                return f.read()
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
