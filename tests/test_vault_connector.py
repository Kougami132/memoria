"""Tests for vault connectors."""
import os
import pytest
from memoria.vault.connector import LocalConnector, SUPPORTED_EXTS, WebDAVConnector, _normalize_webdav_path, _relative_to_root


def test_supported_exts():
    assert ".md" in SUPPORTED_EXTS
    assert ".txt" in SUPPORTED_EXTS


def test_local_connector_list_files(tmp_path):
    (tmp_path / "note.md").write_text("hello")
    (tmp_path / "readme.txt").write_text("world")
    (tmp_path / "image.png").write_bytes(b"\x89PNG")
    sub = tmp_path / "sub"
    sub.mkdir()
    (sub / "deep.md").write_text("deep")

    conn = LocalConnector(str(tmp_path))
    files = conn.list_files()

    assert "note.md" in files
    assert "readme.txt" in files
    assert "image.png" not in files
    assert os.path.join("sub", "deep.md") in files or "sub/deep.md" in files


def test_local_connector_read_file(tmp_path):
    (tmp_path / "note.md").write_text("hello world")
    conn = LocalConnector(str(tmp_path))
    content = conn.read_file("note.md")
    assert content == b"hello world"


def test_local_connector_list_files_missing_path():
    conn = LocalConnector("/nonexistent/path/that/does/not/exist")
    with pytest.raises(Exception):
        conn.list_files()


def test_local_connector_read_file_missing():
    conn = LocalConnector("/tmp")
    with pytest.raises(Exception):
        conn.read_file("does_not_exist.md")


def test_normalize_webdav_path():
    assert _normalize_webdav_path(None) == "/"
    assert _normalize_webdav_path("Notes/Inbox/") == "/Notes/Inbox"
    assert _normalize_webdav_path("//Notes//Inbox") == "/Notes/Inbox"


def test_relative_to_webdav_endpoint_root():
    path = "/remote.php/dav/files/me/Notes/nested/file.md"
    root = "/remote.php/dav/files/me/Notes"
    assert _relative_to_root(path, root) == "nested/file.md"


def test_webdav_list_dirs_skips_current_directory():
    class FakeClient:
        def list(self, remote_path, get_info=True):
            assert remote_path == "/Notes"
            assert get_info is True
            return [
                {"isdir": True, "path": "/Notes"},
                {"isdir": True, "path": "/Notes/Child"},
                {"isdir": True, "path": "/Notes/Child/Grand"},
                {"isdir": False, "path": "/Notes/file.md"},
            ]

    conn = WebDAVConnector.__new__(WebDAVConnector)
    conn._client = FakeClient()
    conn._href_root = "/remote.php/dav/files/me"

    assert conn.list_dirs("/Notes") == ["/Notes/Child", "/Notes/Child/Grand"]
