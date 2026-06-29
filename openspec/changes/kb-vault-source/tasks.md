## 1. DB 迁移与数据模型

- [x] 1.1 在 `storage/db.py` 新增 `VaultRow`（`vaults` 表）和 `VaultFileRow`（`vault_files` 表）SQLAlchemy 模型
- [x] 1.2 `DocumentRow` 新增 `source` 列（默认 `"upload"`），启动时自动 `ALTER TABLE` 迁移旧数据库
- [x] 1.3 在 `DB` 类中实现 vault CRUD 方法：`create_vault`、`get_vault_by_kb`、`delete_vault`，以及 `delete_kb` 的级联删除逻辑
- [x] 1.4 在 `DB` 类中实现 vault_files 方法：`upsert_vault_file`、`list_vault_files`、`delete_vault_file`

## 2. 同步引擎

- [x] 2.1 新建 `vault/connector.py`，定义 `VaultConnector` 抽象基类（`list_files() -> list[str]`、`read_file(rel_path) -> bytes`）
- [x] 2.2 实现 `LocalConnector`：`os.walk` 遍历本地路径，过滤 `.md`/`.txt`，`read_file` 直接读文件
- [x] 2.3 实现 `WebDAVConnector`：用 `webdavclient3` PROPFIND 列文件，`GET` 读内容；处理连接失败异常
- [x] 2.4 新建 `vault/syncer.py`，实现 `VaultSyncer.sync(vault_id)`：拉取文件列表 → 计算 SHA-256 → 与 vault_files 对比 → 执行新增/更新/删除 → 更新 `last_synced_at`
- [x] 2.5 同步时使用 `tempfile.NamedTemporaryFile` 缓存 WebDAV 内容，确保临时文件自动清理

## 3. 后台调度器

- [x] 3.1 在 `server/app.py` 的 `lifespan` 中启动 `APScheduler AsyncIOScheduler`，注册 interval 任务（默认 15 分钟），服务停止时 shutdown
- [x] 3.2 调度任务遍历所有 vault，调用 `VaultSyncer.sync()`；每个 vault 设 `max_instances=1` 防并发

## 4. API 路由

- [x] 4.1 新建 `server/routes/vaults.py`，实现 `POST /knowledge-bases/{kb_id}/vault`（绑定，触发异步全量扫描）、`GET /knowledge-bases/{kb_id}/vault`（查询，屏蔽密码）、`DELETE /knowledge-bases/{kb_id}/vault`（解绑，级联删除）
- [x] 4.2 在 `vaults.py` 实现 `POST /knowledge-bases/{kb_id}/vault/sync`（手动触发，返回 202）
- [x] 4.3 在 `server/app.py` 注册 vaults router
- [ ] 4.4 修改 `routes/knowledge_bases.py`：KB 详情和列表响应中附加 vault 信息
- [x] 4.5 修改 `routes/documents.py`：删除文档时检查 `source` 字段，vault 来源文档返回 409

## 5. 前端 UI

- [x] 5.1 在 KB 详情/设置页新增 vault 绑定区域：显示当前绑定状态（未绑定/已绑定+类型+last_synced_at）
- [x] 5.2 实现绑定表单：选择类型（local/WebDAV），local 填路径，WebDAV 填 URL+用户名+密码
- [x] 5.3 实现解绑按钮（需确认对话框，提示将删除所有相关文档）
- [x] 5.4 实现"立即同步"按钮，调用手动 sync 端点，显示加载状态
- [x] 5.5 在 `web/src/api.ts` 新增 vault 相关 API 函数（createVault、getVault、deleteVault、syncVault）

## 6. 验证

- [ ] 6.1 本地 vault 全量同步：创建含 .md/.txt 文件的目录，绑定后验证文档被录入 KB
- [ ] 6.2 增量同步验证：修改文件内容后手动 sync，验证旧向量被替换
- [ ] 6.3 文件删除验证：删除源文件后 sync，验证对应 doc 被移除
- [ ] 6.4 解绑验证：解绑后确认 vault、vault_files、documents、Chroma 向量均清除
- [ ] 6.5 WebDAV 连接失败处理：填入错误 URL，确认同步失败不影响现有数据

