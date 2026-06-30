---
comet_change: vault-sync-control
role: technical-design
canonical_spec: openspec
---

# vault-sync-control Design Doc

## 目标

修复 vault 同步的可靠性问题：`syncing` 状态修复、重复触发防护、文件级取消、per-vault 自动同步开关、间隔可配置。

## 架构

### 1. syncing 状态修复

所有 sync 调用点（`_run_sync`、`_initial_sync`、`_sync_all_vaults`）包裹 try/finally：

```python
db.set_vault_syncing(vault_id, True)
try:
    VaultSyncer(db, pipeline).sync(vault_id)
finally:
    db.set_vault_syncing(vault_id, False)
```

`sync_vault` 端点增加前置检查：

```python
if vault["syncing"]:
    raise HTTPException(status_code=409, detail="Vault sync already in progress")
```

### 2. 文件级取消

模块级全局变量存取消信号：

```python
# vaults.py
_cancel_events: dict[str, threading.Event] = {}
```

`VaultSyncer.sync()` 新增参数：

```python
def sync(self, vault_id: str, cancel_event: threading.Event | None = None) -> None:
```

在 `new_files` 和 `present_files` 循环中每个文件处理完后检查：

```python
if cancel_event and cancel_event.is_set():
    break
```

`deleted_files` 不受取消影响，保持删除逻辑的一致性。

新增端点：

```
DELETE /api/knowledge-bases/{kb_id}/vault/sync
```

设置 `_cancel_events[vault_id]`，返回 204。

### 3. per-vault auto_sync

`VaultRow` 新增列：

```python
auto_sync = Column(Integer, default=1)  # 0=off, 1=on（SQLite 兼容）
```

DB 初始化迁移：

```python
if "auto_sync" not in vault_cols:
    conn.execute(text("ALTER TABLE vaults ADD COLUMN auto_sync INTEGER DEFAULT 1"))
```

`_vault_dict` 中返回 `"auto_sync": bool(row.auto_sync)`。

新增端点：

```
PATCH /api/knowledge-bases/{kb_id}/vault
body: { "auto_sync": bool }
```

`_sync_all_vaults` 跳过 `auto_sync=False` 的 vault。

### 4. 动态调度间隔

scheduler 实例挂在 `app.state`：

```python
app.state.scheduler = scheduler
```

`settings.py` 路由通过 `Request` 获取 scheduler，在更新 `vault_sync_interval_minutes` 时：

```python
minutes = int(value)
request.app.state.scheduler.reschedule_job(
    "vault_poll", trigger="interval", minutes=minutes
)
```

启动时从 `runtime_settings` 读取初始间隔（默认 15）。

### 5. 受影响文件

| 文件 | 改动 |
|------|------|
| `memoria/storage/db.py` | auto_sync 列、迁移、_vault_dict 更新 |
| `memoria/vault/syncer.py` | cancel_event 参数 |
| `memoria/server/routes/vaults.py` | syncing 修复、409 检查、取消端点、PATCH 端点 |
| `memoria/server/routes/settings.py` | 更新间隔时 reschedule |
| `memoria/server/app.py` | syncing 修复、跳过 auto_sync=False、读取间隔、app.state.scheduler |
| `web/src/api.ts` | Vault.auto_sync、cancelVaultSync、updateVault、Settings.vault_sync_interval_minutes |
| `web/src/pages/KnowledgeBases.tsx` | 停止同步按钮、auto_sync 开关 |
| `web/src/pages/Settings.tsx` | 间隔配置项 |

### 6. 测试策略

- syncing：sync 期间 syncing=True，完成后 False，异常后也 False（finally 保证）
- 重复触发：syncing=True 时 POST sync → 409
- 取消：设置 cancel_event 后 sync 在文件边界停止，syncing 重置
- auto_sync=False：定时任务跳过该 vault
- 间隔更新：reschedule_job 被调用且下一次触发时间变化
