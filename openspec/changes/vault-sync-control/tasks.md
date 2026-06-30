## Tasks

- [ ] `db.py`：`VaultRow` 新增 `auto_sync` 字段，DB 初始化加 schema 迁移
- [ ] `vault/syncer.py`：`sync()` 新增 `cancel_event` 参数，循环中检查取消信号
- [ ] `vaults.py`：`_run_sync`/`_initial_sync` 调用 `set_vault_syncing`；`sync_vault` 检查 syncing 状态返回 409；新增取消端点 `DELETE .../vault/sync`；新增 `PATCH .../vault` 更新 auto_sync
- [ ] `app.py`：`_sync_all_vaults` 调用 `set_vault_syncing`；跳过 `auto_sync=false` vault；从 settings 读取间隔；支持动态重调度
- [ ] `api.ts`：`Vault` 接口增加 `auto_sync`；新增 `cancelVaultSync`、`updateVault`；`Settings` 增加 `vault_sync_interval_minutes`
- [ ] `KnowledgeBases.tsx`：同步中按钮变「停止同步」；vault 卡片加 auto_sync 开关
- [ ] `Settings.tsx`：加自动同步间隔配置项
- [ ] 运行测试确认通过
