---
change: kb-vault-source
design-doc: docs/superpowers/specs/2026-06-29-kb-vault-source-design.md
base-ref: 2629d65b79949df5408c8f44ff6e3abe0a87ae73
---

# KB Vault Source 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 为 Memoria 知识库引入 Vault（仓库）来源，支持绑定本地文件夹或 WebDAV 端点，实现文件自动录入与增量同步。

**Architecture:** 新增 `memoria/vault/` 模块，包含连接器抽象（`connector.py`）和同步引擎（`syncer.py`）；在 SQLite 增加 `vaults` / `vault_files` 两张表及 `documents.source` 列；通过 FastAPI 路由暴露 vault CRUD 和手动同步 API；APScheduler 每 15 分钟轮询所有 vault 执行后台同步；前端在 `KnowledgeBases.tsx` 的每个 KB 卡片中插入 `VaultPanel` 组件。

**Tech Stack:** Python 3.11、FastAPI、SQLAlchemy 2.0、APScheduler 3.10、webdavclient3 3.14、React 18、TanStack Query v5、TypeScript

## Global Constraints

- Python >= 3.11
- 支持文件格式：仅 `.md` / `.txt`
- vault 与 KB 为 1:1 关系，由 `vaults.kb_id UNIQUE` 约束强制
- WebDAV 密码明文存储（设计文档已确认）
- `pipeline.ingest()` 接受文件路径，WebDAV 内容须先落盘临时文件
- APScheduler interval 默认 15 分钟，`max_instances=1`
- 测试时 `create_app()` 不传 `lifespan`，不启动调度器
- `documents.source` 默认 `"upload"`，已有记录通过 ALTER TABLE 迁移
- vault 来源文档不可通过文档删除 API 手动删除（返回 409）

---

## 文件结构

| 文件 | 改动类型 | 职责 |
|------|---------|------|
| `memoria/vault/__init__.py` | 新增 | 包标识 |
| `memoria/vault/connector.py` | 新增 | 连接器抽象基类 + LocalConnector + WebDAVConnector |
| `memoria/vault/syncer.py` | 新增 | VaultSyncer：diff + ingest + delete 逻辑 |
| `memoria/storage/db.py` | 修改 | 新增 VaultRow/VaultFileRow 模型、source 列迁移、vault CRUD 方法 |
| `memoria/core/pipeline.py` | 修改 | `ingest()` 新增可选 `source` 参数 |
| `memoria/server/app.py` | 修改 | 新增 lifespan（APScheduler）、注册 vaults router |
| `memoria/server/deps.py` | 修改 | 新增 `get_syncer()` 依赖 |
| `memoria/server/routes/vaults.py` | 新增 | vault CRUD + 手动 sync 路由 |
| `memoria/server/routes/documents.py` | 修改 | 删除文档时检查 source，vault 文档返回 409 |
| `pyproject.toml` | 修改 | 新增 webdavclient3、apscheduler 依赖 |
| `web/src/api.ts` | 修改 | 新增 Vault 接口、vault API 函数 |
| `web/src/pages/KnowledgeBases.tsx` | 修改 | 新增 VaultPanel 组件 |
| `tests/test_vault_syncer.py` | 新增 | LocalConnector + VaultSyncer 单元测试 |
| `tests/test_server.py` | 修改 | vault API 集成测试 |

---

## Task 2: DB 数据模型与迁移

**Files:**
- Modify: `memoria/storage/db.py`
- Test: `tests/test_storage.py`（扩展）

**Interfaces:**
- Consumes: 无前置任务
- Produces:
  - `DocumentRow.source` 列（String，默认 `"upload"`）
  - `DB.create_doc(kb_id, filename, path, chunk_count, source="upload") -> dict`（含 source）
  - `DB.get_doc(doc_id) -> dict`（含 source）
  - `DB.list_docs(kb_id) -> list[dict]`（含 source）
  - `DB.create_vault(kb_id, type, **kwargs) -> dict`
  - `DB.get_vault_by_kb(kb_id) -> dict | None`
  - `DB.get_vault(vault_id) -> dict | None`
  - `DB.list_vaults() -> list[dict]`
  - `DB.delete_vault(vault_id) -> None`（级联删 vault_files）
  - `DB.update_vault_last_synced(vault_id, ts) -> None`
  - `DB.upsert_vault_file(vault_id, rel_path, file_hash, doc_id) -> dict`
  - `DB.list_vault_files(vault_id) -> list[dict]`
  - `DB.delete_vault_file(vault_file_id) -> None`
  - `DB.delete_kb(kb_id)` 扩展级联删 vault

- [x] **Step 1: 写失败测试**

在 `tests/test_storage.py` 末尾追加：

```python
from memoria.storage.db import DB

def test_vault_crud(tmp_path):
    db = DB(str(tmp_path / "v.db"))
    kb = db.create_kb("kb1")
    v = db.create_vault(kb["id"], "local", local_path="/tmp/docs")
    assert v["type"] == "local"
    assert v["local_path"] == "/tmp/docs"
    assert v["last_synced_at"] is None
    assert db.get_vault_by_kb(kb["id"])["id"] == v["id"]
    assert db.get_vault(v["id"])["kb_id"] == kb["id"]
    assert len(db.list_vaults()) == 1
    db.update_vault_last_synced(v["id"], "2026-01-01T00:00:00+00:00")
    assert db.get_vault(v["id"])["last_synced_at"] == "2026-01-01T00:00:00+00:00"
    db.delete_vault(v["id"])
    assert db.get_vault(v["id"]) is None

def test_vault_file_crud(tmp_path):
    db = DB(str(tmp_path / "v.db"))
    kb = db.create_kb("kb1")
    v = db.create_vault(kb["id"], "local", local_path="/tmp/docs")
    vf = db.upsert_vault_file(v["id"], "notes.md", "abc123", None)
    assert vf["rel_path"] == "notes.md"
    files = db.list_vault_files(v["id"])
    assert len(files) == 1
    db.delete_vault_file(vf["id"])
    assert db.list_vault_files(v["id"]) == []

def test_vault_unique_per_kb(tmp_path):
    import pytest as _pytest
    db = DB(str(tmp_path / "v.db"))
    kb = db.create_kb("kb1")
    db.create_vault(kb["id"], "local", local_path="/tmp/a")
    with _pytest.raises(Exception):
        db.create_vault(kb["id"], "local", local_path="/tmp/b")

def test_delete_kb_cascades_vault(tmp_path):
    db = DB(str(tmp_path / "v.db"))
    kb = db.create_kb("kb1")
    v = db.create_vault(kb["id"], "local", local_path="/tmp/docs")
    db.upsert_vault_file(v["id"], "a.md", "hash1", None)
    db.delete_kb(kb["id"])
    assert db.get_vault(v["id"]) is None
    assert db.list_vault_files(v["id"]) == []

def test_doc_source_field(tmp_path):
    db = DB(str(tmp_path / "v.db"))
    kb = db.create_kb("kb1")
    doc = db.create_doc(kb["id"], "f.md", "/path/f.md", 3)
    assert doc["source"] == "upload"
    doc2 = db.create_doc(kb["id"], "f2.md", "/path/f2.md", 2, source="vault")
    assert doc2["source"] == "vault"
    assert db.get_doc(doc2["id"])["source"] == "vault"
    assert all("source" in d for d in db.list_docs(kb["id"]))
```

- [x] **Step 2: 运行测试确认失败**

```
pytest tests/test_storage.py -k "vault or doc_source" -v
```
预期：`AttributeError: 'DB' object has no attribute 'create_vault'`

- [x] **Step 3: 添加 ORM 模型**

在 `db.py` 的 `RuntimeSettingRow` 之前插入：

```python
class VaultRow(Base):
    __tablename__ = "vaults"
    id              = Column(String, primary_key=True)
    kb_id           = Column(String, ForeignKey("knowledge_bases.id"), unique=True, nullable=False)
    type            = Column(String, nullable=False)
    local_path      = Column(String, nullable=True)
    webdav_url      = Column(String, nullable=True)
    webdav_username = Column(String, nullable=True)
    webdav_password = Column(String, nullable=True)
    last_synced_at  = Column(String, nullable=True)
    created_at      = Column(String, nullable=False)


class VaultFileRow(Base):
    __tablename__ = "vault_files"
    id        = Column(String, primary_key=True)
    vault_id  = Column(String, ForeignKey("vaults.id"), nullable=False)
    rel_path  = Column(String, nullable=False)
    file_hash = Column(String, nullable=False)
    doc_id    = Column(String, nullable=True)
    synced_at = Column(String, nullable=False)
```

- [x] **Step 4: 更新 DocumentRow 添加 source 列**

将 `DocumentRow` 改为（添加 `source` 行，其他不变）：

```python
class DocumentRow(Base):
    __tablename__ = "documents"
    id          = Column(String, primary_key=True)
    kb_id       = Column(String, ForeignKey("knowledge_bases.id"), nullable=False)
    filename    = Column(String, nullable=False)
    path        = Column(String, nullable=False)
    chunk_count = Column(Integer, default=0)
    source      = Column(String, default="upload")
    created_at  = Column(String, nullable=False)
```

- [x] **Step 5: 添加 documents.source 迁移**

在 `DB.__init__` 中，messages 迁移块之后追加：

```python
        with engine.connect() as conn:
            doc_cols = [r[1] for r in conn.execute(text("PRAGMA table_info(documents)"))]
            if "source" not in doc_cols:
                conn.execute(text("ALTER TABLE documents ADD COLUMN source TEXT DEFAULT 'upload'"))
                conn.commit()
```

- [x] **Step 6: 更新 create_doc / get_doc / list_docs 返回 source**

```python
    def create_doc(self, kb_id: str, filename: str, path: str, chunk_count: int,
                   source: str = "upload") -> dict:
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
```

- [x] **Step 7: 实现 vault CRUD 方法**

在 `delete_kb` 之后、`# ── Bots` 注释之前添加：

```python
    # ── Vaults ───────────────────────────────────────────────────────────────

    def _vault_dict(self, row: "VaultRow") -> dict:
        return {
            "id": row.id, "kb_id": row.kb_id, "type": row.type,
            "local_path": row.local_path, "webdav_url": row.webdav_url,
            "webdav_username": row.webdav_username, "webdav_password": row.webdav_password,
            "last_synced_at": row.last_synced_at, "created_at": row.created_at,
        }

    def create_vault(self, kb_id: str, type: str, **kwargs) -> dict:
        with self._s() as s:
            row = VaultRow(id=_uid(), kb_id=kb_id, type=type, created_at=_now(), **kwargs)
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

    def upsert_vault_file(self, vault_id: str, rel_path: str,
                          file_hash: str, doc_id: str | None) -> dict:
        with self._s() as s:
            row = s.query(VaultFileRow).filter(
                VaultFileRow.vault_id == vault_id,
                VaultFileRow.rel_path == rel_path,
            ).first()
            if row:
                row.file_hash = file_hash
                row.doc_id = doc_id
                row.synced_at = _now()
            else:
                row = VaultFileRow(id=_uid(), vault_id=vault_id, rel_path=rel_path,
                                   file_hash=file_hash, doc_id=doc_id, synced_at=_now())
                s.add(row)
            s.flush()
            return {"id": row.id, "vault_id": row.vault_id, "rel_path": row.rel_path,
                    "file_hash": row.file_hash, "doc_id": row.doc_id, "synced_at": row.synced_at}

    def list_vault_files(self, vault_id: str) -> list[dict]:
        with self._s() as s:
            return [{"id": r.id, "vault_id": r.vault_id, "rel_path": r.rel_path,
                     "file_hash": r.file_hash, "doc_id": r.doc_id, "synced_at": r.synced_at}
                    for r in s.query(VaultFileRow).filter(VaultFileRow.vault_id == vault_id).all()]

    def delete_vault_file(self, vault_file_id: str) -> None:
        with self._s() as s:
            row = s.get(VaultFileRow, vault_file_id)
            if row:
                s.delete(row)
```

- [x] **Step 8: 更新 delete_kb 级联删除 vault**

```python
    def delete_kb(self, kb_id: str) -> None:
        with self._s() as s:
            vault = s.query(VaultRow).filter(VaultRow.kb_id == kb_id).first()
            if vault:
                s.query(VaultFileRow).filter(VaultFileRow.vault_id == vault.id).delete()
                s.delete(vault)
            s.query(BotKBLink).filter(BotKBLink.kb_id == kb_id).delete()
            s.query(DocumentRow).filter(DocumentRow.kb_id == kb_id).delete()
            row = s.get(KnowledgeBaseRow, kb_id)
            if row:
                s.delete(row)
```

- [x] **Step 9: 运行全部存储测试**

```
pytest tests/test_storage.py -v
```
预期：全部 PASSED

- [x] **Step 10: Commit**

```bash
git add memoria/storage/db.py tests/test_storage.py
git commit -m "feat: DB 新增 vault/vault_files 模型与迁移，documents 添加 source 字段"
```

---

## Task 1: 依赖新增

**Files:**
- Modify: `pyproject.toml`

**Interfaces:**
- Produces: `webdavclient3` 和 `apscheduler` 可被后续任务 import

- [x] **Step 1: 写失败测试**

新建 `tests/test_vault_deps.py`：

```python
import importlib

def test_webdavclient3_importable():
    mod = importlib.import_module("webdav3.client")
    assert hasattr(mod, "Client")

def test_apscheduler_importable():
    mod = importlib.import_module("apscheduler.schedulers.asyncio")
    assert hasattr(mod, "AsyncIOScheduler")
```

- [x] **Step 2: 运行测试确认失败**

```
pytest tests/test_vault_deps.py -v
```
预期：ModuleNotFoundError

- [x] **Step 3: 添加依赖**

在 `pyproject.toml` 的 `dependencies` 列表末尾追加两行：
```
"webdavclient3>=3.14",
"apscheduler>=3.10",
```
同时在 `[tool.setuptools] packages` 列表中添加 `"memoria.vault"`。

- [x] **Step 4: 安装依赖**

```
pip install -e ".[dev]"
```

- [x] **Step 5: 运行测试确认通过**

```
pytest tests/test_vault_deps.py -v
```
预期：2 tests PASSED

- [x] **Step 6: Commit**

```bash
git add pyproject.toml tests/test_vault_deps.py
git commit -m "chore: 新增 webdavclient3 和 apscheduler 依赖"
```

---

## Task 3: Vault 连接器模块

**Files:**
- Create: `memoria/vault/__init__.py`
- Create: `memoria/vault/connector.py`
- Test: `tests/test_vault_syncer.py`（新建，LocalConnector 部分）

**Interfaces:**
- Consumes: Task 1（webdavclient3 已安装）
- Produces:
  - `SUPPORTED_EXTS = {".md", ".txt"}`
  - `VaultConnector` 抽象基类，方法：`list_files() -> list[str]`、`read_file(rel_path: str) -> bytes`
  - `LocalConnector(root: str)`，实现上述方法
  - `WebDAVConnector(url: str, username: str, password: str)`，实现上述方法

- [x] **Step 1: 写 LocalConnector 失败测试**

新建 `tests/test_vault_syncer.py`：

```python
import os
import pytest
from memoria.vault.connector import LocalConnector

def test_local_list_files(tmp_path):
    (tmp_path / "a.md").write_text("hello")
    (tmp_path / "b.txt").write_text("world")
    (tmp_path / "c.pdf").write_bytes(b"skip")
    sub = tmp_path / "sub"
    sub.mkdir()
    (sub / "d.md").write_text("deep")

    conn = LocalConnector(str(tmp_path))
    files = conn.list_files()
    assert "a.md" in files
    assert "b.txt" in files
    assert "c.pdf" not in files
    assert "sub/d.md" in files

def test_local_read_file(tmp_path):
    (tmp_path / "note.md").write_bytes(b"content")
    conn = LocalConnector(str(tmp_path))
    assert conn.read_file("note.md") == b"content"

def test_local_read_missing_raises(tmp_path):
    conn = LocalConnector(str(tmp_path))
    with pytest.raises(Exception):
        conn.read_file("nonexistent.md")
```

- [x] **Step 2: 运行测试确认失败**

```
pytest tests/test_vault_syncer.py -v
```
预期：`ModuleNotFoundError: No module named 'memoria.vault'`

- [x] **Step 3: 创建 vault 包**

新建 `memoria/vault/__init__.py`（空文件）：

```python
```

- [x] **Step 4: 实现 connector.py**

新建 `memoria/vault/connector.py`：

```python
from __future__ import annotations

import os
import posixpath
import tempfile
from abc import ABC, abstractmethod

SUPPORTED_EXTS = {".md", ".txt"}


class VaultConnector(ABC):
    @abstractmethod
    def list_files(self) -> list[str]:
        """返回所有支持格式文件的相对路径列表（posixpath 格式）。"""
        ...

    @abstractmethod
    def read_file(self, rel_path: str) -> bytes:
        """读取文件内容。失败时抛出异常。"""
        ...


class LocalConnector(VaultConnector):
    def __init__(self, root: str) -> None:
        self.root = root

    def list_files(self) -> list[str]:
        result = []
        for dirpath, _, filenames in os.walk(self.root):
            for fname in filenames:
                if os.path.splitext(fname)[1].lower() in SUPPORTED_EXTS:
                    abs_path = os.path.join(dirpath, fname)
                    rel = os.path.relpath(abs_path, self.root)
                    result.append(rel.replace(os.sep, "/"))
        return result

    def read_file(self, rel_path: str) -> bytes:
        with open(os.path.join(self.root, rel_path), "rb") as f:
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
        all_items = self._client.list(get_info=True)
        result = []
        for item in all_items:
            path = item.get("path", "")
            if os.path.splitext(path)[1].lower() in SUPPORTED_EXTS:
                result.append(path.lstrip("/"))
        return result

    def read_file(self, rel_path: str) -> bytes:
        suffix = os.path.splitext(rel_path)[1]
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=True) as tmp:
            self._client.download_sync(rel_path, tmp.name)
            return open(tmp.name, "rb").read()
```

- [x] **Step 5: 运行测试确认通过**

```
pytest tests/test_vault_syncer.py -v
```
预期：3 tests PASSED

- [x] **Step 6: Commit**

```bash
git add memoria/vault/__init__.py memoria/vault/connector.py tests/test_vault_syncer.py
git commit -m "feat: 新增 vault 连接器模块 LocalConnector + WebDAVConnector"
```

---

## Task 4: VaultSyncer 同步引擎 + pipeline.ingest source 参数

**Files:**
- Create: `memoria/vault/syncer.py`
- Modify: `memoria/core/pipeline.py`
- Test: `tests/test_vault_syncer.py`（扩展）

**Interfaces:**
- Consumes: Task 2（DB vault 方法）、Task 3（LocalConnector/WebDAVConnector）
- Produces:
  - `Pipeline.ingest(kb_id, path, source="upload") -> dict`
  - `VaultSyncer(db: DB, pipeline: Pipeline)`
  - `VaultSyncer.sync(vault_id: str) -> None`

- [x] **Step 1: 写失败测试**

在 `tests/test_vault_syncer.py` 末尾追加：

```python
from unittest.mock import patch
from memoria.vault.syncer import VaultSyncer
from memoria.storage.db import DB
from memoria.core.pipeline import Pipeline
from memoria.core.embedder import MockEmbedder
from memoria.llm.caller import MockLLMCaller

def _make_db_vault(tmp_path):
    db = DB(str(tmp_path / "test.db"))
    kb = db.create_kb("kb1")
    vault = db.create_vault(kb["id"], "local", local_path=str(tmp_path / "docs"))
    return db, kb, vault

def _make_pipeline(tmp_path, db):
    return Pipeline(db=db, embedder=MockEmbedder(), llm=MockLLMCaller(),
                    chroma_path=str(tmp_path / "chroma"), top_k=5)

def test_syncer_new_files(tmp_path):
    docs = tmp_path / "docs"
    docs.mkdir()
    (docs / "a.md").write_text("hello world content for embedding")
    db, kb, vault = _make_db_vault(tmp_path)
    syncer = VaultSyncer(db, _make_pipeline(tmp_path, db))
    syncer.sync(vault["id"])
    files = db.list_vault_files(vault["id"])
    assert len(files) == 1
    assert files[0]["rel_path"] == "a.md"
    assert files[0]["doc_id"] is not None
    assert db.get_vault(vault["id"])["last_synced_at"] is not None

def test_syncer_deleted_files(tmp_path):
    docs = tmp_path / "docs"
    docs.mkdir()
    f = docs / "a.md"
    f.write_text("content for embedding test")
    db, kb, vault = _make_db_vault(tmp_path)
    syncer = VaultSyncer(db, _make_pipeline(tmp_path, db))
    syncer.sync(vault["id"])
    f.unlink()
    syncer.sync(vault["id"])
    assert db.list_vault_files(vault["id"]) == []
    assert db.list_docs(kb["id"]) == []

def test_syncer_changed_file(tmp_path):
    docs = tmp_path / "docs"
    docs.mkdir()
    f = docs / "a.md"
    f.write_text("original content for embedding")
    db, kb, vault = _make_db_vault(tmp_path)
    syncer = VaultSyncer(db, _make_pipeline(tmp_path, db))
    syncer.sync(vault["id"])
    first_hash = db.list_vault_files(vault["id"])[0]["file_hash"]
    f.write_text("updated content for embedding now different")
    syncer.sync(vault["id"])
    new_hash = db.list_vault_files(vault["id"])[0]["file_hash"]
    assert new_hash != first_hash

def test_syncer_connector_failure_preserves_data(tmp_path):
    docs = tmp_path / "docs"
    docs.mkdir()
    (docs / "a.md").write_text("hello content")
    db, kb, vault = _make_db_vault(tmp_path)
    syncer = VaultSyncer(db, _make_pipeline(tmp_path, db))
    syncer.sync(vault["id"])
    ts_before = db.get_vault(vault["id"])["last_synced_at"]
    from memoria.vault.connector import LocalConnector
    with patch.object(LocalConnector, "list_files", side_effect=RuntimeError("fail")):
        syncer.sync(vault["id"])
    assert len(db.list_vault_files(vault["id"])) == 1
    assert db.get_vault(vault["id"])["last_synced_at"] == ts_before
```

- [x] **Step 2: 运行测试确认失败**

```
pytest tests/test_vault_syncer.py -k "syncer" -v
```
预期：`ModuleNotFoundError: No module named 'memoria.vault.syncer'`

- [x] **Step 3: 更新 pipeline.ingest 支持 source 参数**

将 `memoria/core/pipeline.py` 的 `ingest` 方法改为：

```python
    def ingest(self, kb_id: str, path: str, source: str = "upload") -> dict:
        chunks = [c for c in Chunker().split(path) if c.strip()]
        if not chunks:
            raise ValueError("File produced no embeddable content")
        doc_id = os.path.basename(path).replace(".", "_") + "_" + kb_id[:8]
        vectors = self._embedder.embed(chunks)
        ids = [f"{doc_id}__{i}" for i in range(len(chunks))]
        metadatas = [{"doc_id": doc_id} for _ in chunks]
        self._get_store(kb_id).add(ids, vectors, chunks, metadatas)
        doc = self.db.create_doc(kb_id, os.path.basename(path), path, len(chunks), source=source)
        return {"doc_id": doc_id, "chunk_count": len(chunks), "doc": doc}
```

- [x] **Step 4: 新建 memoria/vault/syncer.py**

```python
from __future__ import annotations

import hashlib
import logging
import os
import tempfile
from datetime import datetime, timezone

from memoria.core.pipeline import Pipeline
from memoria.storage.db import DB
from memoria.vault.connector import LocalConnector, VaultConnector, WebDAVConnector

logger = logging.getLogger(__name__)


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class VaultSyncer:
    def __init__(self, db: DB, pipeline: Pipeline) -> None:
        self.db = db
        self.pipeline = pipeline

    def sync(self, vault_id: str) -> None:
        vault = self.db.get_vault(vault_id)
        connector = self._make_connector(vault)
        try:
            current = set(connector.list_files())
        except Exception:
            logger.exception("vault_sync: list_files failed vault_id=%s", vault_id)
            return
        tracked = {f["rel_path"]: f for f in self.db.list_vault_files(vault_id)}
        new_files = current - tracked.keys()
        present_files = current & tracked.keys()
        deleted_files = tracked.keys() - current
        for rel_path in deleted_files:
            row = tracked[rel_path]
            if row["doc_id"]:
                self._delete_doc(row["doc_id"], vault["kb_id"])
            self.db.delete_vault_file(row["id"])
        for rel_path in new_files:
            self._ingest_file(connector, vault, rel_path)
        for rel_path in present_files:
            row = tracked[rel_path]
            try:
                content = connector.read_file(rel_path)
                new_hash = _sha256(content)
                if new_hash != row["file_hash"]:
                    if row["doc_id"]:
                        self._delete_doc(row["doc_id"], vault["kb_id"])
                    self._ingest_file(connector, vault, rel_path, content=content)
            except Exception:
                logger.warning("vault_sync: skip changed file %s", rel_path)
        self.db.update_vault_last_synced(vault_id, _now())

    def _make_connector(self, vault: dict) -> VaultConnector:
        if vault["type"] == "local":
            return LocalConnector(vault["local_path"])
        return WebDAVConnector(
            vault["webdav_url"],
            vault["webdav_username"] or "",
            vault["webdav_password"] or "",
        )

    def _delete_doc(self, doc_id: str, kb_id: str) -> None:
        try:
            self.pipeline._get_store(kb_id).delete(where={"doc_id": doc_id})
            self.db.delete_doc(doc_id)
        except Exception:
            logger.error("vault_sync: failed to delete doc_id=%s", doc_id)

    def _ingest_file(self, connector: VaultConnector, vault: dict,
                     rel_path: str, content: bytes | None = None) -> None:
        if content is None:
            try:
                content = connector.read_file(rel_path)
            except Exception:
                logger.warning("vault_sync: skip file read error %s", rel_path)
                return
        suffix = os.path.splitext(rel_path)[1]
        tmp_path = None
        try:
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                tmp.write(content)
                tmp_path = tmp.name
            result = self.pipeline.ingest(vault["kb_id"], tmp_path, source="vault")
        except Exception:
            logger.error("vault_sync: ingest failed %s", rel_path)
            return
        finally:
            if tmp_path:
                try:
                    os.unlink(tmp_path)
                except Exception:
                    pass
        self.db.upsert_vault_file(vault["id"], rel_path, _sha256(content), result["doc"]["id"])
```

- [x] **Step 5: 运行测试确认通过**

```
pytest tests/test_vault_syncer.py -v
```
预期：全部 PASSED

- [x] **Step 6: 运行全量测试确认无回归**

```
pytest tests/ -v
```
预期：全部 PASSED

- [x] **Step 7: Commit**

```bash
git add memoria/vault/syncer.py memoria/core/pipeline.py tests/test_vault_syncer.py
git commit -m "feat: 实现 VaultSyncer 同步引擎，pipeline.ingest 支持 source 参数"
```

---

## Task 5: FastAPI 路由 + 后台调度器

**Files:**
- Create: `memoria/server/routes/vaults.py`
- Modify: `memoria/server/app.py`
- Modify: `memoria/server/deps.py`
- Modify: `memoria/server/routes/documents.py`
- Test: `tests/test_server.py`（扩展）

**Interfaces:**
- Consumes: Task 2（DB vault 方法）、Task 4（VaultSyncer）
- Produces:
  - `POST /api/knowledge-bases/{kb_id}/vault` → 201
  - `GET /api/knowledge-bases/{kb_id}/vault` → 200（密码屏蔽）
  - `DELETE /api/knowledge-bases/{kb_id}/vault` → 204
  - `POST /api/knowledge-bases/{kb_id}/vault/sync` → 202
  - `DELETE /api/documents/{doc_id}` → 409 当 source="vault"
- [x] **Step 1: 写失败测试**

在 `tests/test_server.py` 末尾追加：

```python
from unittest.mock import patch, MagicMock

def test_vault_bind_and_get(client):
    kb = client.post("/api/knowledge-bases", json={"name": "kb1", "description": ""}).json()
    r = client.post(f"/api/knowledge-bases/{kb[\"id\"]}/vault",
                    json={"type": "local", "local_path": "/tmp/docs"})
    assert r.status_code == 201
    data = r.json()
    assert data["type"] == "local"
    assert "webdav_password" not in data
    r2 = client.get(f"/api/knowledge-bases/{kb[\"id\"]}/vault")
    assert r2.status_code == 200

def test_vault_duplicate_409(client):
    kb = client.post("/api/knowledge-bases", json={"name": "kb2", "description": ""}).json()
    client.post(f"/api/knowledge-bases/{kb[\"id\"]}/vault", json={"type": "local", "local_path": "/tmp/a"})
    r = client.post(f"/api/knowledge-bases/{kb[\"id\"]}/vault", json={"type": "local", "local_path": "/tmp/b"})
    assert r.status_code == 409

def test_vault_delete_204(client):
    kb = client.post("/api/knowledge-bases", json={"name": "kb3", "description": ""}).json()
    client.post(f"/api/knowledge-bases/{kb[\"id\"]}/vault", json={"type": "local", "local_path": "/tmp/docs"})
    r = client.delete(f"/api/knowledge-bases/{kb[\"id\"]}/vault")
    assert r.status_code == 204
    assert client.get(f"/api/knowledge-bases/{kb[\"id\"]}/vault").status_code == 404

def test_vault_manual_sync_202(client):
    kb = client.post("/api/knowledge-bases", json={"name": "kb4", "description": ""}).json()
    client.post(f"/api/knowledge-bases/{kb[\"id\"]}/vault", json={"type": "local", "local_path": "/tmp/docs"})
    with patch("memoria.server.routes.vaults.VaultSyncer") as mock_cls:
        mock_cls.return_value.sync = MagicMock()
        r = client.post(f"/api/knowledge-bases/{kb[\"id\"]}/vault/sync")
    assert r.status_code == 202
```

- [x] **Step 2: 运行测试确认失败**

```
pytest tests/test_server.py -k "vault" -v
```
预期：404（路由未注册）

- [x] **Step 3: 在 deps.py 添加 get_syncer**

在 `memoria/server/deps.py` 末尾追加：

```python
def get_syncer() -> "VaultSyncer":
    from memoria.vault.syncer import VaultSyncer
    return VaultSyncer(get_db(), get_pipeline())
```

- [x] **Step 4: 新建 memoria/server/routes/vaults.py**

```python
from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from memoria.core.pipeline import Pipeline
from memoria.server.deps import get_db, get_pipeline, get_syncer
from memoria.storage.db import DB
from memoria.vault.syncer import VaultSyncer

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/knowledge-bases", tags=["vaults"])


class VaultCreate(BaseModel):
    type: str
    local_path: str | None = None
    webdav_url: str | None = None
    webdav_username: str | None = None
    webdav_password: str | None = None


def _public(vault: dict) -> dict:
    return {k: v for k, v in vault.items() if k != "webdav_password"}


@router.post("/{kb_id}/vault", status_code=201)
async def bind_vault(kb_id: str, body: VaultCreate,
                     db: DB = Depends(get_db),
                     syncer: VaultSyncer = Depends(get_syncer)):
    if db.get_kb(kb_id) is None:
        raise HTTPException(404, "Knowledge base not found")
    if db.get_vault_by_kb(kb_id) is not None:
        raise HTTPException(409, "Vault already bound")
    kwargs = {k: v for k, v in body.model_dump().items()
              if k != "type" and v is not None}
    vault = db.create_vault(kb_id, body.type, **kwargs)
    loop = asyncio.get_event_loop()
    asyncio.create_task(loop.run_in_executor(None, syncer.sync, vault["id"]))
    return _public(vault)


@router.get("/{kb_id}/vault")
def get_vault(kb_id: str, db: DB = Depends(get_db)):
    vault = db.get_vault_by_kb(kb_id)
    if vault is None:
        raise HTTPException(404, "No vault bound")
    return _public(vault)


@router.delete("/{kb_id}/vault", status_code=204)
def unbind_vault(kb_id: str, db: DB = Depends(get_db),
                 pipeline: Pipeline = Depends(get_pipeline)):
    vault = db.get_vault_by_kb(kb_id)
    if vault is None:
        raise HTTPException(404, "No vault bound")
    for vf in db.list_vault_files(vault["id"]):
        if vf["doc_id"]:
            try:
                pipeline._get_store(kb_id).delete(where={"doc_id": vf["doc_id"]})
                db.delete_doc(vf["doc_id"])
            except Exception:
                logger.error("unbind_vault: failed to delete doc %s", vf["doc_id"])
    db.delete_vault(vault["id"])


@router.post("/{kb_id}/vault/sync", status_code=202)
async def sync_vault(kb_id: str, db: DB = Depends(get_db),
                     syncer: VaultSyncer = Depends(get_syncer)):
    vault = db.get_vault_by_kb(kb_id)
    if vault is None:
        raise HTTPException(404, "No vault bound")
    loop = asyncio.get_event_loop()
    asyncio.create_task(loop.run_in_executor(None, syncer.sync, vault["id"]))
    return {"status": "sync started"}
```

- [x] **Step 5: 更新 documents.py 阻止删除 vault 文档**

在 `delete_document` 函数的 404 检查之后，`store.delete` 之前插入：

```python
    if doc.get("source") == "vault":
        raise HTTPException(status_code=409,
                            detail="Cannot manually delete vault-sourced document")
```

- [x] **Step 6: 更新 app.py 注册 vaults router 并添加 lifespan**

完整替换 `memoria/server/app.py`：

```python
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI

from memoria.server.routes import bots, chat, documents, knowledge_bases, settings, sessions, vaults

VAULT_POLL_MINUTES = 15


@asynccontextmanager
async def lifespan(app: FastAPI):
    from apscheduler.schedulers.asyncio import AsyncIOScheduler
    from memoria.server.deps import get_db, get_pipeline
    from memoria.vault.syncer import VaultSyncer

    def _sync_all():
        db = get_db()
        syncer = VaultSyncer(db, get_pipeline())
        for vault in db.list_vaults():
            try:
                syncer.sync(vault["id"])
            except Exception:
                logging.getLogger(__name__).exception(
                    "vault poll failed: vault_id=%s", vault["id"])

    scheduler = AsyncIOScheduler()
    scheduler.add_job(_sync_all, "interval", minutes=VAULT_POLL_MINUTES,
                      max_instances=1, id="vault_poll")
    scheduler.start()
    yield
    scheduler.shutdown(wait=False)


def create_app(lifespan=None) -> FastAPI:
    app = FastAPI(title="Memoria", lifespan=lifespan)
    app.include_router(knowledge_bases.router, prefix="/api")
    app.include_router(bots.router, prefix="/api")
    app.include_router(documents.router, prefix="/api")
    app.include_router(chat.router, prefix="/api")
    app.include_router(settings.router, prefix="/api")
    app.include_router(sessions.router, prefix="/api")
    app.include_router(vaults.router, prefix="/api")

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    static_dir = os.path.join(os.path.dirname(__file__), "..", "static")
    if os.path.isdir(static_dir):
        from fastapi.staticfiles import StaticFiles
        from fastapi.responses import FileResponse

        assets_dir = os.path.join(static_dir, "assets")
        if os.path.isdir(assets_dir):
            app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

        index_html = os.path.join(static_dir, "index.html")

        @app.get("/{full_path:path}", include_in_schema=False)
        async def serve_spa(full_path: str):
            candidate = os.path.join(static_dir, full_path)
            if full_path and os.path.isfile(candidate):
                return FileResponse(candidate)
            return FileResponse(index_html)
    else:
        logging.warning("memoria/static/ not found -- Web UI unavailable.")

    return app


app = create_app(lifespan=lifespan)
```

- [x] **Step 7: 运行测试确认通过**

```
pytest tests/test_server.py -k "vault" -v
```
预期：全部 PASSED

- [x] **Step 8: 运行全量测试**

```
pytest tests/ -v
```
预期：全部 PASSED

- [x] **Step 9: Commit**

```bash
git add memoria/server/routes/vaults.py memoria/server/app.py memoria/server/deps.py memoria/server/routes/documents.py tests/test_server.py
git commit -m "feat: vault API 路由、后台调度器、vault 文档删除保护"
```

---

## Task 6: 前端 API 层 + VaultPanel 组件

**Files:**
- Modify: `web/src/api.ts`
- Modify: `web/src/pages/KnowledgeBases.tsx`

**Interfaces:**
- Consumes: Task 5（vault 路由已上线）
- Produces:
  - `Vault` 接口、`VaultCreate` 接口、`Doc.source` 字段
  - `getVault`, `createVault`, `deleteVault`, `syncVault` 函数
  - `VaultPanel` 组件（绑定/已绑定+解绑+立即同步）
  - vault 来源文档：隐藏删除按钮，显示 vault badge

- [x] **Step 1: 更新 web/src/api.ts**

将原有的 `Doc` 接口替换为含 `source` 字段的版本，并添加 Vault 相关类型和函数。

完整更新后的 `api.ts`（修改部分）：

将 `export interface Doc` 改为：
```typescript
export interface Doc {
  id: string; kb_id: string; filename: string; chunk_count: number;
  source: 'upload' | 'vault'; created_at: string
}
```

在 `Doc` 接口之后插入：
```typescript
export interface Vault {
  id: string; kb_id: string; type: 'local' | 'webdav';
  local_path?: string; webdav_url?: string; webdav_username?: string;
  last_synced_at: string | null; created_at: string;
}
export interface VaultCreate {
  type: 'local' | 'webdav';
  local_path?: string;
  webdav_url?: string;
  webdav_username?: string;
  webdav_password?: string;
}
```

在文件末尾追加：
```typescript
export const getVault = (kbId: string) =>
  req<Vault>(`/knowledge-bases/${kbId}/vault`)
export const createVault = (kbId: string, data: VaultCreate) =>
  req<Vault>(`/knowledge-bases/${kbId}/vault`, { method: 'POST', ...json(data) })
export const deleteVault = (kbId: string) =>
  req<void>(`/knowledge-bases/${kbId}/vault`, { method: 'DELETE' })
export const syncVault = (kbId: string) =>
  req<{ status: string }>(`/knowledge-bases/${kbId}/vault/sync`, { method: 'POST' })
```

- [x] **Step 2: TypeScript 编译检查**

```
cd web && npx tsc --noEmit
```
预期：无错误

- [x] **Step 3: 在 KnowledgeBases.tsx 添加 VaultPanel import 和组件**

在文件顶部的 import 行中添加新图标：
```tsx
import { Plus, ChevronDown, ChevronRight, FileText, Trash2, Upload, Database, HardDrive, Globe, RefreshCw, Unlink } from 'lucide-react'
```

在 `DocList` 函数之前插入完整的 `VaultPanel` 组件：

```tsx
function VaultPanel({ kbId }: { kbId: string }) {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [vaultType, setVaultType] = useState<'local' | 'webdav'>('local')
  const [localPath, setLocalPath] = useState('')
  const [webdavUrl, setWebdavUrl] = useState('')
  const [webdavUser, setWebdavUser] = useState('')
  const [webdavPass, setWebdavPass] = useState('')

  const { data: vault } = useQuery({
    queryKey: ['vault', kbId],
    queryFn: () => api.getVault(kbId).catch(() => null),
    retry: false,
  })

  const bind = useMutation({
    mutationFn: () => api.createVault(kbId,
      vaultType === 'local'
        ? { type: 'local', local_path: localPath }
        : { type: 'webdav', webdav_url: webdavUrl,
            webdav_username: webdavUser, webdav_password: webdavPass }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vault', kbId] })
      qc.invalidateQueries({ queryKey: ['docs', kbId] })
      setShowForm(false)
    },
  })

  const unbind = useMutation({
    mutationFn: () => api.deleteVault(kbId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vault', kbId] })
      qc.invalidateQueries({ queryKey: ['docs', kbId] })
    },
  })

  const sync = useMutation({
    mutationFn: () => api.syncVault(kbId),
    onSuccess: () => setTimeout(
      () => qc.invalidateQueries({ queryKey: ['docs', kbId] }), 2000),
  })

  return (
    <div className="mb-4 rounded-lg border bg-muted/10 p-3">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">仓库来源</p>
      {!vault ? (
        showForm ? (
          <div className="space-y-2">
            <div className="flex gap-2">
              <Button variant={vaultType === 'local' ? 'default' : 'outline'} size="sm"
                      onClick={() => setVaultType('local')}>本地文件夹</Button>
              <Button variant={vaultType === 'webdav' ? 'default' : 'outline'} size="sm"
                      onClick={() => setVaultType('webdav')}>WebDAV</Button>
            </div>
            {vaultType === 'local' ? (
              <Input placeholder="/path/to/folder" value={localPath}
                     onChange={e => setLocalPath(e.target.value)} className="text-sm h-8" />
            ) : (
              <div className="space-y-1.5">
                <Input placeholder="https://dav.example.com" value={webdavUrl}
                       onChange={e => setWebdavUrl(e.target.value)} className="text-sm h-8" />
                <Input placeholder="用户名" value={webdavUser}
                       onChange={e => setWebdavUser(e.target.value)} className="text-sm h-8" />
                <Input type="password" placeholder="密码" value={webdavPass}
                       onChange={e => setWebdavPass(e.target.value)} className="text-sm h-8" />
              </div>
            )}
            <div className="flex gap-2">
              <Button size="sm" onClick={() => bind.mutate()} disabled={bind.isPending}>
                {bind.isPending ? '绑定中…' : '确认绑定'}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>取消</Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" size="sm" className="gap-1.5 text-xs h-7"
                  onClick={() => setShowForm(true)}>
            <HardDrive className="h-3 w-3" /> 绑定仓库
          </Button>
        )
      ) : (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm">
            {vault.type === 'local'
              ? <HardDrive className="h-4 w-4 text-blue-500" />
              : <Globe className="h-4 w-4 text-green-500" />}
            <span className="truncate max-w-[200px]">
              {vault.local_path ?? vault.webdav_url}
            </span>
            {vault.last_synced_at && (
              <span className="text-xs text-muted-foreground">
                {new Date(vault.last_synced_at).toLocaleString()}
              </span>
            )}
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7"
                    title="立即同步" disabled={sync.isPending}
                    onClick={() => sync.mutate()}>
              <RefreshCw className={`h-3.5 w-3.5 ${sync.isPending ? 'animate-spin' : ''}`} />
            </Button>
            <Button variant="ghost" size="icon" title="解绑"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      if (confirm('解绑仓库将删除所有仓库来源文档，确认操作？'))
                        unbind.mutate()
                    }}>
              <Unlink className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [x] **Step 4: 更新 DocList 处理 vault 文档**

在 DocList 组件的文档行中，将删除按钮的 `<Button>` 部分改为：

```tsx
{doc.source !== 'vault' ? (
  <Button
    variant="ghost"
    size="icon"
    className="h-7 w-7 text-muted-foreground hover:text-destructive"
    onClick={() => {
      if (confirm(`确认删除文档「${doc.filename}」？`)) delDoc.mutate(doc.id)
    }}
  >
    <Trash2 className="h-3.5 w-3.5" />
  </Button>
) : (
  <Badge variant="secondary" className="text-xs font-normal">vault</Badge>
)}
```

- [x] **Step 5: 在 KB 展开区域插入 VaultPanel**

在 `KnowledgeBases.tsx` 的展开内容块（`{expanded.has(kb.id) && (`）中，`<DocList>` 之前添加：

```tsx
<VaultPanel kbId={kb.id} />
```

- [x] **Step 6: TypeScript 编译检查**

```
cd web && npx tsc --noEmit
```
预期：无错误

- [x] **Step 7: 构建前端**

```
cd web && npm run build
```
预期：Build 成功，无错误，生成 `memoria/static/assets/` 文件

- [x] **Step 8: Commit**

```bash
git add web/src/api.ts web/src/pages/KnowledgeBases.tsx
git commit -m "feat: 前端 VaultPanel 组件与 vault API 对接"
```

---

## 任务依赖关系

```
Task 1 (依赖) ─────────────────────────────────────────────────────┐
Task 2 (DB 模型)    ────────────────────────────────────────────────┤
Task 3 (连接器) ──> Task 4 (同步引擎) ──> Task 5 (API 路由) ──> Task 6 (前端)
Task 2 (DB 方法) ──/
```

- Task 1 可与 Task 2、3 并行
- Task 4 必须在 Task 2 和 Task 3 完成之后
- Task 5 必须在 Task 4 完成之后
- Task 6 必须在 Task 5 完成之后（API 接口已定义可提前开发 UI，但集成测试需 Task 5）

---

## 验证清单

完成所有任务后，手动验证以下场景：

- [x] 本地 vault 全量同步：创建含 .md/.txt 文件的目录，绑定后验证文档被录入 KB
- [x] 增量同步验证：修改文件内容后手动 sync，验证旧向量被替换
- [x] 文件删除验证：删除源文件后 sync，验证对应 doc 被移除
- [x] 解绑验证：解绑后确认 vault、vault_files、documents、Chroma 向量均清除
- [x] WebDAV 连接失败处理：填入错误 URL，确认同步失败不影响现有数据
- [x] vault 文档删除保护：尝试手动删除 vault 来源文档，确认返回 409
