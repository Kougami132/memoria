---
change: vault-sync-control
design-doc: docs/superpowers/specs/2026-06-30-vault-sync-control-design.md
base-ref: 57463276a3685f84d5f63c4b2b944d4fc4a8ad51
---

# 实施计划：vault-sync-control

## 全局约束

- 所有 SQLite 布尔字段用 Integer（0/1），不用 Boolean（兼容性）
- cancel_events 存模块级全局 `dict[str, threading.Event]`，在 `vaults.py` 顶层定义
- scheduler 实例挂 `app.state.scheduler`，settings 路由通过 `Request` 获取
- 所有 sync 调用点用 try/finally 包裹 set_vault_syncing

## 任务 1：`db.py` — auto_sync 字段与迁移

**目标**：`VaultRow` 新增 `auto_sync = Column(Integer, default=1)`；DB 初始化加迁移；`_vault_dict` 返回 `"auto_sync": bool(row.auto_sync)`；新增 `update_vault_auto_sync(vault_id, auto_sync: bool)` 方法。

**步骤**：
1. `VaultRow` 加 `auto_sync = Column(Integer, default=1)`
2. `__init__` 中迁移检查：
   ```python
   if "auto_sync" not in vault_cols:
       conn.execute(text("ALTER TABLE vaults ADD COLUMN auto_sync INTEGER DEFAULT 1"))
   ```
3. `_vault_dict` 加 `"auto_sync": bool(row.auto_sync)`
4. 新增方法：
   ```python
   def update_vault_auto_sync(self, vault_id: str, auto_sync: bool) -> None:
       with self._s() as s:
           row = s.get(VaultRow, vault_id)
           if row:
               row.auto_sync = int(auto_sync)
   ```

**测试**：新建 vault 默认 auto_sync=True；update_vault_auto_sync 后读回 False；迁移逻辑（已有 DB 加列）。

---

## 任务 2：`vault/syncer.py` — cancel_event 参数

**目标**：`sync()` 新增 `cancel_event: threading.Event | None = None`，在 new_files 和 present_files 循环中每个文件完成后检查取消信号。

**步骤**：
1. import threading（若未 import）
2. 签名改为：`def sync(self, vault_id: str, cancel_event: threading.Event | None = None) -> None:`
3. `for rel_path in new_files:` 循环体末尾加：
   ```python
   if cancel_event and cancel_event.is_set():
       break
   ```
4. `for rel_path in present_files:` 循环体末尾同样加检查
5. `deleted_files` 循环不加检查

**测试**：预设 cancel_event 并提前 set，确认循环在第一个文件后停止；不传 cancel_event 时行为不变。

---

## 任务 3：`vaults.py` — syncing 修复 + 取消端点 + PATCH

**目标**：
- `_run_sync`、`_initial_sync` 调用 `set_vault_syncing`
- `sync_vault` 前置检查 syncing，已同步中返回 409
- 新增模块级 `_cancel_events: dict[str, threading.Event] = {}`
- 新增 `DELETE /api/knowledge-bases/{kb_id}/vault/sync` 取消端点
- 新增 `PATCH /api/knowledge-bases/{kb_id}/vault` 更新 auto_sync

**步骤**：

```python
import threading
_cancel_events: dict[str, threading.Event] = {}
```

`_run_sync` 改为：
```python
def _run_sync():
    cancel_event = threading.Event()
    _cancel_events[vault["id"]] = cancel_event
    db.set_vault_syncing(vault["id"], True)
    try:
        VaultSyncer(db, pipeline).sync(vault["id"], cancel_event=cancel_event)
    except Exception:
        logger.exception("vault: manual sync failed vault_id=%s", vault["id"])
    finally:
        db.set_vault_syncing(vault["id"], False)
        _cancel_events.pop(vault["id"], None)
```

`_initial_sync` 同样包裹（不需要 cancel_event，初始同步不允许取消）。

`sync_vault` 加前置检查：
```python
if vault["syncing"]:
    raise HTTPException(status_code=409, detail="Vault sync already in progress")
```

取消端点：
```python
@router.delete("/knowledge-bases/{kb_id}/vault/sync", status_code=204)
def cancel_vault_sync(kb_id: str, db: DB = Depends(get_db)):
    vault = db.get_vault_by_kb(kb_id)
    if vault is None:
        raise HTTPException(status_code=404, detail="No vault bound to this knowledge base")
    event = _cancel_events.get(vault["id"])
    if event:
        event.set()
```

PATCH 端点：
```python
class VaultUpdate(BaseModel):
    auto_sync: Optional[bool] = None

@router.patch("/knowledge-bases/{kb_id}/vault")
def update_vault(kb_id: str, body: VaultUpdate, db: DB = Depends(get_db)):
    vault = db.get_vault_by_kb(kb_id)
    if vault is None:
        raise HTTPException(status_code=404, detail="No vault bound to this knowledge base")
    if body.auto_sync is not None:
        db.update_vault_auto_sync(vault["id"], body.auto_sync)
    return _mask_vault(db.get_vault_by_kb(kb_id))
```

**测试**：syncing=True 时 POST sync 返回 409；DELETE sync 后 cancel_event.is_set()=True；PATCH auto_sync=False 后 vault.auto_sync=False。

---

## 任务 4：`app.py` — syncing 修复 + auto_sync 过滤 + 动态间隔

**目标**：
- `_sync_all_vaults` 调用 set_vault_syncing，跳过 auto_sync=False vault
- 从 runtime_settings 读取初始间隔
- scheduler 挂 app.state

**步骤**：

```python
def _sync_all_vaults():
    db = get_db()
    pipeline = get_pipeline()
    syncer = VaultSyncer(db, pipeline)
    for vault in db.list_vaults():
        if not vault.get("auto_sync", True):
            continue
        if vault.get("syncing"):
            continue
        db.set_vault_syncing(vault["id"], True)
        try:
            syncer.sync(vault["id"])
        except Exception:
            logging.getLogger(__name__).exception(
                "vault poll failed: vault_id=%s", vault["id"]
            )
        finally:
            db.set_vault_syncing(vault["id"], False)
```

初始间隔读取：
```python
from memoria.server.deps import get_effective_settings
s = get_effective_settings(get_db())
interval_minutes = int(s.get("vault_sync_interval_minutes", 15))
scheduler.add_job(_sync_all_vaults, "interval", minutes=interval_minutes, ...)
app.state.scheduler = scheduler
```

**测试**：auto_sync=False 的 vault 被跳过；syncing=True 的 vault 被跳过（避免并发）。

---

## 任务 5：`settings.py` — 间隔更新时动态重调度

**目标**：PUT /settings 更新 vault_sync_interval_minutes 时调用 reschedule_job。

**步骤**：
路由函数签名加 `request: Request`，更新后：
```python
if "vault_sync_interval_minutes" in changed_keys:
    scheduler = getattr(request.app.state, "scheduler", None)
    if scheduler and scheduler.running:
        minutes = int(db.get_setting("vault_sync_interval_minutes") or 15)
        scheduler.reschedule_job("vault_poll", trigger="interval", minutes=minutes)
```

**测试**：更新间隔后 scheduler.get_job("vault_poll") 的下次触发时间变化。

---

## 任务 6：`api.ts` — 接口和方法扩展

**目标**：
- `Vault` 加 `auto_sync: boolean`
- 新增 `cancelVaultSync(kbId: string)`
- 新增 `updateVault(kbId: string, body: { auto_sync: boolean })`
- `Settings` 加 `vault_sync_interval_minutes: string`

---

## 任务 7：`KnowledgeBases.tsx` — 停止按钮 + auto_sync 开关

**目标**：
- 同步中时按钮显示「停止同步」，点击调用 `cancelVaultSync`
- vault 卡片加 auto_sync Toggle（调用 `updateVault`，乐观更新）

**步骤**：
```tsx
// 停止同步按钮
const cancelSync = useMutation({ mutationFn: () => api.cancelVaultSync(kbId) })

<Button
  disabled={!isSyncing && isSyncing !== undefined}
  onClick={() => isSyncing ? cancelSync.mutate() : syncVault.mutate()}
>
  {isSyncing ? '停止同步' : '立即同步'}
</Button>

// auto_sync 开关
const toggleAutoSync = useMutation({
  mutationFn: (v: boolean) => api.updateVault(kbId, { auto_sync: v }),
  onSuccess: () => refetchVault(),
})
```

---

## 任务 8：`Settings.tsx` — 间隔配置项

**目标**：在 Settings 页加 `vault_sync_interval_minutes` 输入项（数字，分钟）。

---

## 任务 9：运行测试确认通过
