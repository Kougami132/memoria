# Brainstorm Summary

- Change: kb-vault-source
- Date: 2026-06-29

## 确认的技术方案

### 架构布局
```
memoria/vault/connector.py   — VaultConnector ABC + LocalConnector + WebDAVConnector
memoria/vault/syncer.py      — VaultSyncer.sync(vault_id)，普通 def
memoria/storage/db.py        — VaultRow / VaultFileRow + vault_* 方法
memoria/server/app.py        — 新增 lifespan + AsyncIOScheduler
memoria/server/routes/vaults.py — vault CRUD + /sync 端点
web/src/api.ts               — vault API 函数
web/src/pages/KnowledgeBases.tsx — VaultPanel 组件
```

### DB 层
- 新增 `vaults` 表（kb_id unique 约束强制 1:1）、`vault_files` 表
- `documents` 表 ALTER TABLE 添加 `source` 列（默认 `"upload"`），复用现有迁移模式

### 同步引擎
- `sync()` 为普通 `def`（非 async），与现有代码风格一致
- WebDAV 用 `webdavclient3`（同步库），APScheduler 自动放线程池
- 手动触发：`asyncio.get_event_loop().run_in_executor(None, syncer.sync, vault_id)`
- 错误处理：连接失败 → 全量终止保留现有数据；单文件失败 → 跳过记录 warning

### APScheduler 集成
- `app.py` 新增 lifespan（asynccontextmanager）
- `AsyncIOScheduler`，interval=15min，`max_instances=1`（全局防并发）
- `_sync_all_vaults()` 顺序遍历所有 vault，单个异常不影响后续

### 前端 UI
- `VaultPanel` 组件嵌入 KB 展开区域上方（DocList 上方）
- 未绑定：显示绑定按钮 + 折叠表单（local/WebDAV 两种类型）
- 已绑定：显示类型/路径/last_synced_at + "立即同步"按钮 + 解绑按钮
- DocList：vault 来源文档隐藏删除按钮，加 `vault` 徽章

## 关键取舍与风险

- sync() 普通 def 而非 async：与现有代码一致，避免混用复杂度，无功能影响
- 顺序执行所有 vault（非并发）：MVP 够用，避免 Chroma 写锁竞争
- 明文凭证：已知风险，用户接受，后续迭代加密
- webdavclient3 兼容性：不同 WebDAV 服务行为差异，连接失败只记录日志

## 测试策略

- `VaultSyncer` 单测：mock connector + mock pipeline，覆盖 diff 逻辑（新增/变更/删除/连接失败/单文件失败降级）
- API 集成测试：复用 TestClient + tmp_path 模式，mock VaultSyncer.sync
- 前端手动验证：绑定/同步/解绑主流程

## Spec Patch

无（所有场景已在 delta spec 中覆盖）
