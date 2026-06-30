# Comet Design Handoff

- Change: vault-sync-control
- Phase: design
- Mode: compact
- Context hash: 85323bfab637719cdb9a42dfecc33b5368b3fd65b1338a90df989eadefc44c5d

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/vault-sync-control/proposal.md

- Source: openspec/changes/vault-sync-control/proposal.md
- Lines: 1-28
- SHA256: 21d48505425a59e43fc5cca39ac46bc8785ae10200986cc3a3fcefd98d19cafc

```md
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
```

## openspec/changes/vault-sync-control/design.md

- Source: openspec/changes/vault-sync-control/design.md
- Lines: 1-63
- SHA256: fcdd47fc5816750866841e72cc8e29664279e0cfa183aaa6f81365b69f7b196b

```md
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
```

## openspec/changes/vault-sync-control/tasks.md

- Source: openspec/changes/vault-sync-control/tasks.md
- Lines: 1-10
- SHA256: 18e46ec2929d92c0e9ce9842b824ff5a583786fc3e0ee87c83f14c046642cabc

```md
## Tasks

- [ ] `db.py`：`VaultRow` 新增 `auto_sync` 字段，DB 初始化加 schema 迁移
- [ ] `vault/syncer.py`：`sync()` 新增 `cancel_event` 参数，循环中检查取消信号
- [ ] `vaults.py`：`_run_sync`/`_initial_sync` 调用 `set_vault_syncing`；`sync_vault` 检查 syncing 状态返回 409；新增取消端点 `DELETE .../vault/sync`；新增 `PATCH .../vault` 更新 auto_sync
- [ ] `app.py`：`_sync_all_vaults` 调用 `set_vault_syncing`；跳过 `auto_sync=false` vault；从 settings 读取间隔；支持动态重调度
- [ ] `api.ts`：`Vault` 接口增加 `auto_sync`；新增 `cancelVaultSync`、`updateVault`；`Settings` 增加 `vault_sync_interval_minutes`
- [ ] `KnowledgeBases.tsx`：同步中按钮变「停止同步」；vault 卡片加 auto_sync 开关
- [ ] `Settings.tsx`：加自动同步间隔配置项
- [ ] 运行测试确认通过
```

