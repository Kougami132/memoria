---
comet_change: kb-vault-source
role: technical-design
canonical_spec: openspec
---

# KB Vault Source — Technical Design

## 1. 背景与范围

Memoria 知识库目前只支持手动逐文件上传。本次变更为 KB 引入 **Vault（仓库）来源**，允许绑定本地文件夹或 WebDAV 端点，绑定后自动录入所有 `.md`/`.txt` 文件，并通过手动触发 + 后台轮询保持同步。

**受影响文件：**

| 文件 | 改动类型 |
|------|---------|
| `memoria/vault/connector.py` | 新增 |
| `memoria/vault/syncer.py` | 新增 |
| `memoria/vault/__init__.py` | 新增 |
| `memoria/storage/db.py` | 修改（新增表/方法/迁移） |
| `memoria/server/app.py` | 修改（新增 lifespan） |
| `memoria/server/routes/vaults.py` | 新增 |
| `memoria/server/deps.py` | 修改（新增 get_syncer） |
| `web/src/api.ts` | 修改（新增 vault API） |
| `web/src/pages/KnowledgeBases.tsx` | 修改（新增 VaultPanel） |
| `pyproject.toml` | 修改（新增依赖） |

## 2. 数据模型

### 2.1 新增表

```python
class VaultRow(Base):
    __tablename__ = "vaults"
    id              = Column(String, primary_key=True)
    kb_id           = Column(String, ForeignKey("knowledge_bases.id"), unique=True, nullable=False)
    type            = Column(String, nullable=False)      # "local" | "webdav"
    local_path      = Column(String, nullable=True)
    webdav_url      = Column(String, nullable=True)
    webdav_username = Column(String, nullable=True)
    webdav_password = Column(String, nullable=True)       # 明文存储
    last_synced_at  = Column(String, nullable=True)
    created_at      = Column(String, nullable=False)

class VaultFileRow(Base):
    __tablename__ = "vault_files"
    id         = Column(String, primary_key=True)
    vault_id   = Column(String, ForeignKey("vaults.id"), nullable=False)
    rel_path   = Column(String, nullable=False)           # 相对 vault root 的路径
    file_hash  = Column(String, nullable=False)           # SHA-256 hex
    doc_id     = Column(String, nullable=True)            # FK documents.id
    synced_at  = Column(String, nullable=False)
```

`kb_id` 加 `unique=True`，在 DB 层强制 1:1 关系，防止 race condition 绕过 API 层检查。

### 2.2 documents 表迁移

启动时检查 `source` 列，不存在则自动迁移（复用现有迁移模式）：

```python
if "source" not in cols:
    conn.execute(text("ALTER TABLE documents ADD COLUMN source TEXT DEFAULT 'upload'"))
    conn.commit()
```

现有所有 documents 记录自动获得 `source = "upload"`，无需手动迁移数据。

### 2.3 新增 DB 方法

```python
# vault CRUD
create_vault(kb_id, type, **kwargs) -> dict
get_vault_by_kb(kb_id) -> dict | None
get_vault(vault_id) -> dict | None
list_vaults() -> list[dict]           # 调度器使用
delete_vault(vault_id) -> None        # 级联删除 vault_files
update_vault_last_synced(vault_id, ts) -> None

# vault_files
upsert_vault_file(vault_id, rel_path, file_hash, doc_id) -> dict
list_vault_files(vault_id) -> list[dict]   # 返回 {rel_path: row} dict
delete_vault_file(vault_file_id) -> None
```

`delete_kb()` 扩展：级联删除 vault（触发 `delete_vault` → vault_files），Chroma collection 清理逻辑不变。

## 3. 同步引擎

### 3.1 连接器抽象

```python
# memoria/vault/connector.py
from abc import ABC, abstractmethod

SUPPORTED_EXTS = {".md", ".txt"}

class VaultConnector(ABC):
    @abstractmethod
    def list_files(self) -> list[str]:
        """返回所有支持格式文件的相对路径列表。连接失败时抛出异常。"""
        ...

    @abstractmethod
    def read_file(self, rel_path: str) -> bytes:
        """读取文件内容。失败时抛出异常。"""
        ...


class LocalConnector(VaultConnector):
    def __init__(self, root: str) -> None:
        self.root = root

    def list_files(self) -> list[str]:
        # os.walk，过滤 SUPPORTED_EXTS，返回 rel_path（posixpath 格式）
        ...

    def read_file(self, rel_path: str) -> bytes:
        # open(os.path.join(self.root, rel_path), "rb").read()
        ...


class WebDAVConnector(VaultConnector):
    def __init__(self, url: str, username: str, password: str) -> None:
        # webdavclient3.Client，构造时不做网络请求
        ...

    def list_files(self) -> list[str]:
        # client.list(recursive=True)，过滤 SUPPORTED_EXTS
        ...

    def read_file(self, rel_path: str) -> bytes:
        # 用 tempfile.NamedTemporaryFile，client.download_sync 到临时文件，读取后自动清理
        ...
```

### 3.2 同步流程

```python
# memoria/vault/syncer.py
class VaultSyncer:
    def __init__(self, db: DB, pipeline: Pipeline) -> None:
        self.db = db
        self.pipeline = pipeline

    def sync(self, vault_id: str) -> None:
        vault = self.db.get_vault(vault_id)
        connector = self._make_connector(vault)

        # 1. 获取当前文件列表（失败则抛出，外层 catch）
        current = set(connector.list_files())

        # 2. 获取已追踪文件 {rel_path -> vault_file_row}
        tracked = {f["rel_path"]: f for f in self.db.list_vault_files(vault_id)}

        # 3. diff
        new_files     = current - tracked.keys()
        present_files = current & tracked.keys()
        deleted_files = tracked.keys() - current

        # 4. 删除
        for rel_path in deleted_files:
            row = tracked[rel_path]
            if row["doc_id"]:
                self._delete_doc(row["doc_id"], vault["kb_id"])
            self.db.delete_vault_file(row["id"])

        # 5. 新增
        for rel_path in new_files:
            self._ingest_file(connector, vault, rel_path)

        # 6. 变更检测
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
```

**错误处理边界：**

| 场景 | 行为 |
|------|------|
| `connector.list_files()` 失败 | 抛出异常，外层 catch，`last_synced_at` 不更新，现有数据保留 |
| 单个文件 `read_file` 失败 | 跳过，`logger.warning`，继续其他文件 |
| 单个文件 `ingest()` 失败 | 跳过，`logger.error`，不写 vault_files，继续 |
| deleted 文件的 `doc_id` 为 null | 只删 vault_file 记录，跳过 doc/chroma 删除 |

### 3.3 ingest 辅助

WebDAV 文件 ingest 时需要临时落盘（`pipeline.ingest()` 接受文件路径）：

```python
def _ingest_file(self, connector, vault, rel_path, content=None):
    if content is None:
        try:
            content = connector.read_file(rel_path)
        except Exception:
            logger.warning("vault_sync: skip file read error %s", rel_path)
            return
    with tempfile.NamedTemporaryFile(suffix=os.path.splitext(rel_path)[1], delete=True) as tmp:
        tmp.write(content)
        tmp.flush()
        result = self.pipeline.ingest(vault["kb_id"], tmp.name)
    # 写 vault_files，更新 doc source 字段
    self.db.upsert_vault_file(vault["id"], rel_path, _sha256(content), result["doc"]["id"])
```

`pipeline.ingest()` 写入的 doc 需标记 `source="vault"`，在 `DB.create_doc()` 增加可选 `source` 参数（默认 `"upload"`）。

## 4. APScheduler + lifespan

`app.py` 新增 lifespan，`create_app()` 接受 lifespan 参数：

```python
from contextlib import asynccontextmanager
from apscheduler.schedulers.asyncio import AsyncIOScheduler

VAULT_POLL_MINUTES = 15

@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        _sync_all_vaults,
        "interval",
        minutes=VAULT_POLL_MINUTES,
        max_instances=1,
        id="vault_poll",
    )
    scheduler.start()
    yield
    scheduler.shutdown(wait=False)

def _sync_all_vaults() -> None:
    db = get_db()
    syncer = VaultSyncer(db, get_pipeline())
    for vault in db.list_vaults():
        try:
            syncer.sync(vault["id"])
        except Exception:
            logger.exception("vault poll failed: vault_id=%s", vault["id"])

app = create_app(lifespan=lifespan)
```

**测试隔离：** `conftest.py` 的 `create_app()` 调用不传 lifespan（或传 mock），`TestClient` 不启动调度器。

## 5. API 路由

```
POST   /api/knowledge-bases/{kb_id}/vault        → 绑定，201
GET    /api/knowledge-bases/{kb_id}/vault        → 查询，密码屏蔽
DELETE /api/knowledge-bases/{kb_id}/vault        → 解绑 + 级联删除，204
POST   /api/knowledge-bases/{kb_id}/vault/sync   → 手动触发，202
```

手动 sync 实现：

```python
@router.post("/{kb_id}/vault/sync", status_code=202)
async def sync_vault(kb_id: str, ...):
    vault = db.get_vault_by_kb(kb_id)
    if not vault:
        raise HTTPException(404)
    loop = asyncio.get_event_loop()
    asyncio.create_task(loop.run_in_executor(None, syncer.sync, vault["id"]))
    return {"status": "sync started"}
```

绑定时触发初次全量扫描同理（创建 vault 后立即调用，不阻塞响应）。

## 6. 前端 UI

`KnowledgeBases.tsx` 在每个 KB 展开区域上方插入 `<VaultPanel kbId={kb.id} />`：

```
KBCard（展开后）
├── VaultPanel
│   ├── [未绑定] 绑定仓库按钮 → 展开表单
│   │   ├── 类型切换: 本地文件夹 | WebDAV
│   │   ├── local: 路径输入
│   │   └── webdav: URL / 用户名 / 密码
│   └── [已绑定]
│       ├── 类型图标 + 路径/URL
│       ├── 最后同步时间
│       └── [立即同步 ↻]  [解绑]
└── DocList（原有）
    └── vault 来源文档: 隐藏删除按钮，加 "vault" Badge
```

`api.ts` 新增类型和函数：

```typescript
export interface Vault {
  id: string; kb_id: string; type: "local" | "webdav";
  local_path?: string; webdav_url?: string; webdav_username?: string;
  last_synced_at: string | null; created_at: string;
}
export interface VaultCreate {
  type: "local" | "webdav";
  local_path?: string;
  webdav_url?: string; webdav_username?: string; webdav_password?: string;
}

export const getVault = (kbId: string) => req<Vault>(`/knowledge-bases/${kbId}/vault`)
export const createVault = (kbId: string, data: VaultCreate) =>
  req<Vault>(`/knowledge-bases/${kbId}/vault`, { method: 'POST', ...json(data) })
export const deleteVault = (kbId: string) =>
  req<void>(`/knowledge-bases/${kbId}/vault`, { method: 'DELETE' })
export const syncVault = (kbId: string) =>
  req<{ status: string }>(`/knowledge-bases/${kbId}/vault/sync`, { method: 'POST' })
```

`Doc` 接口新增 `source: "upload" | "vault"` 字段。

## 7. 依赖新增

```toml
# pyproject.toml
"webdavclient3>=3.14",
"apscheduler>=3.10",
```

## 8. 测试策略

**单测（`tests/test_vault_syncer.py`）：**
- 用 `tmp_path` + 真实文件系统测试 `LocalConnector`
- mock `WebDAVConnector` 测试 `VaultSyncer.sync` 的 diff 逻辑：新增/变更/删除/连接失败/单文件失败降级

**集成测试（`tests/test_server.py` 扩展）：**
- 复用 `client` fixture，mock `VaultSyncer.sync`
- 测试 vault CRUD API、409 重复绑定、204 解绑级联、202 手动 sync

**已有测试不受影响：** `documents` 表迁移保持 `source` 默认值，现有上传/删除测试无需修改。
