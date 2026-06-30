# Brainstorm Summary

- Change: vault-sync-control
- Date: 2026-06-30

## 确认的技术方案

1. syncing 修复：所有 sync 调用包裹 try/finally，进入/退出时调用 set_vault_syncing；sync_vault 端点前置检查 syncing，已在同步中返回 409
2. 文件级取消：VaultSyncer.sync() 新增可选 cancel_event 参数，每个文件完成后检查；模块级全局 dict[vault_id, Event] 存放取消信号；新增 DELETE .../vault/sync 端点
3. per-vault auto_sync：VaultRow 新增 auto_sync 列；_sync_all_vaults 跳过 auto_sync=False；新增 PATCH .../vault 端点
4. 动态调度间隔：Settings 更新时调用 scheduler.reschedule_job；scheduler 挂在 app.state

## 关键取舍与风险

- cancel_events 用模块级全局变量（简单，单进程适用）
- 取消粒度是文件级，不是字节级
- 调度间隔修改立即生效，不需要重启

## 测试策略

- syncing 状态：sync 后 syncing=True，完成后 syncing=False，异常后 syncing=False
- 重复触发：syncing=True 时 POST /sync 返回 409
- 取消：cancel 后 sync 在文件边界停止，syncing 重置为 False
- auto_sync=False：定时任务跳过该 vault

## Spec Patch

无
