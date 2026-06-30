## 架构决策

### 1. syncing 状态修复

在 `vaults.py` 的 `_run_sync`、`_initial_sync` 和 `app.py` 的 `_sync_all_vaults` 中，在调用 `VaultSyncer.sync()` 前后分别调用 `db.set_vault_syncing(vault_id, True/False)`，并用 try/finally 保证异常时也能重置。

`sync_vault` 端点先检查 `vault["syncing"]`，若为 true 返回 HTTP 409，防止重复触发。

### 2. 文件级取消（threading.Event）

`VaultSyncer.sync()` 新增可选参数 `cancel_event: threading.Event | None = None`。在处理 `new_files` 和 `present_files` 的循环中，每处理完一个文件检查 `cancel_event.is_set()`，若已取消则 break 退出循环（不处理 `deleted_files`，删除操作不受取消影响）。

取消信号存在内存中（`dict[vault_id, threading.Event]`），挂在 app state 或作为模块级全局变量。

新增端点：`DELETE /api/knowledge-bases/{kb_id}/vault/sync`，设置对应 vault 的 cancel_event。

### 3. per-vault auto_sync 开关

`VaultRow` 新增 `auto_sync = Column(Boolean, default=True)`，DB 初始化时检查列是否存在并迁移。

`app.py` 的 `_sync_all_vaults` 跳过 `auto_sync=False` 的 vault。

新增端点：`PATCH /api/knowledge-bases/{kb_id}/vault`，支持更新 `auto_sync` 字段。

### 4. 动态调度间隔

启动时从 `runtime_settings` 读取 `vault_sync_interval_minutes`（默认 15）设置初始 interval。

`Settings` 的 PUT 端点在更新 `vault_sync_interval_minutes` 时，同时调用 `scheduler.reschedule_job("vault_poll", trigger="interval", minutes=new_interval)`，修改后立即生效，不需要重启。scheduler 实例需从 app 启动时传递到路由（通过 app.state 或依赖注入）。

### 数据流

```
前端点击「停止同步」
  → DELETE /api/knowledge-bases/{kb_id}/vault/sync
  → cancel_events[vault_id].set()
  → VaultSyncer.sync() 在下一个文件边界检测到取消信号并 break
  → finally: set_vault_syncing(False)
  → 前端 polling 检测到 syncing=false，按钮恢复

Settings 修改间隔
  → PUT /api/settings {vault_sync_interval_minutes: 5}
  → scheduler.reschedule_job("vault_poll", trigger="interval", minutes=5)
  → 下一次触发按新间隔计算
```

### API 变更

```typescript
interface Vault {
  // 新增
  auto_sync: boolean
}

// 新增
function cancelVaultSync(kbId: string): Promise<void>
function updateVault(kbId: string, body: { auto_sync: boolean }): Promise<Vault>

interface Settings {
  // 新增
  vault_sync_interval_minutes: string
}
```
