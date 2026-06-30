## Why

vault 同步存在两个可靠性问题：`set_vault_syncing` 从未被调用导致 `syncing` 状态永远为 false，前端按钮禁用逻辑完全失效，用户可以重复触发同步导致同一文件被重复导入；同时缺少停止同步的能力和 per-vault 的自动同步控制，用户体验不完整。

## What Changes

- `db.py`：`VaultRow` 新增 `auto_sync` 字段（Boolean，默认 true）；DB 初始化加迁移
- `vault/syncer.py`：`sync()` 接受可选 `cancel_event: threading.Event`，每处理完一个文件检查取消信号
- `vaults.py`：`_run_sync`、`_initial_sync` 调用 `set_vault_syncing(True/False)`；新增 `DELETE /vault/sync` 取消端点；新增 `PATCH /vault` 更新 `auto_sync`；`sync_vault` 先检查 `syncing` 状态，已在同步中返回 409
- `app.py`：`_sync_all_vaults` 调用 `set_vault_syncing`；跳过 `auto_sync=false` 的 vault；从 `runtime_settings` 读取 `vault_sync_interval_minutes`（默认 15）动态设置调度间隔
- `api.ts`：`Vault` 接口增加 `auto_sync: boolean`；新增 `cancelVaultSync`、`updateVault` API 方法；`Settings` 接口增加 `vault_sync_interval_minutes`
- `KnowledgeBases.tsx`：同步中时按钮显示「停止同步」并调用取消 API；vault 卡片加 auto_sync 开关
- `Settings.tsx`：加自动同步间隔配置项

## Capabilities

### New Capabilities
无（增强已有 vault-sync 能力）

### Modified Capabilities
- `vault-sync`：修复 syncing 状态、新增取消、per-vault auto_sync 开关、间隔可配置

## Impact

- 受影响文件：7 个
- DB schema 变更：`vaults` 表新增 `auto_sync` 列（向后兼容，默认 true）
- `cancel_event` 为可选参数，现有调用不受影响
- APScheduler 调度间隔在应用启动时读取，修改 Settings 后需重启生效（或动态重调度）
