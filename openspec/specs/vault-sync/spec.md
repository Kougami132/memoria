# vault-sync Specification

## Purpose
TBD - created by archiving change kb-vault-source. Update Purpose after archive.
## Requirements
### Requirement: 本地 vault 同步
系统 SHALL 遍历本地路径下所有支持格式文件（`.md`/`.txt`），与 `vault_files` 记录对比，执行增量同步。

#### Scenario: 新文件 ingest
- **WHEN** 同步时本地路径存在 vault_files 中没有记录的 .md/.txt 文件
- **THEN** 调用 `ingest()` 将文件录入 KB，vault_files 写入新记录（rel_path + hash + doc_id）

#### Scenario: 文件内容变更
- **WHEN** 同步时文件的 SHA-256 哈希与 vault_files 中记录不同
- **THEN** 删除旧 doc 的 Chroma 向量和 documents 记录，重新 ingest，更新 vault_files 中的 hash 和 doc_id

#### Scenario: 文件删除
- **WHEN** 同步时 vault_files 中有记录但本地文件已不存在
- **THEN** 删除对应 Chroma 向量、documents 记录、vault_files 记录

#### Scenario: 本地路径不可访问
- **WHEN** 同步时本地路径不存在或无读权限
- **THEN** 同步终止，vault 的 last_synced_at 不更新，错误记录到日志；不删除现有数据

### Requirement: WebDAV vault 同步
系统 SHALL 通过 WebDAV PROPFIND 列出远端文件，下载内容并按哈希进行增量同步。

#### Scenario: WebDAV 新文件 ingest
- **WHEN** 同步时远端存在本地未追踪的 .md/.txt 文件
- **THEN** 下载文件内容到临时位置，调用 `ingest()`，写入 vault_files 记录

#### Scenario: WebDAV 文件内容变更
- **WHEN** 同步时下载的文件内容哈希与 vault_files 记录不同
- **THEN** 删除旧 doc，重新 ingest，更新 vault_files

#### Scenario: WebDAV 文件删除
- **WHEN** 同步时 vault_files 有记录但远端文件已不存在
- **THEN** 删除对应 doc 和向量，移除 vault_files 记录

#### Scenario: WebDAV 连接失败
- **WHEN** 同步时无法连接 WebDAV 服务器（网络错误、认证失败）
- **THEN** 同步终止，现有数据保持不变，错误记录到日志

### Requirement: 手动同步 API
系统 SHALL 提供 `POST /api/knowledge-bases/{kb_id}/vault/sync` 端点触发即时同步。

#### Scenario: 手动触发同步
- **WHEN** POST `/api/knowledge-bases/{kb_id}/vault/sync`
- **THEN** 返回 202，后台异步执行同步，同步完成后更新 `last_synced_at`

#### Scenario: 无 vault 时触发同步
- **WHEN** POST `/api/knowledge-bases/{kb_id}/vault/sync` 但该 KB 无 vault
- **THEN** 返回 404

### Requirement: 后台自动轮询
系统 SHALL 启动时注册后台调度任务，每隔固定间隔（默认 15 分钟）对所有活跃 vault 执行同步。

#### Scenario: 定时自动同步
- **WHEN** 距上次同步超过轮询间隔
- **THEN** 系统自动对所有绑定 vault 依次执行同步，更新 last_synced_at

#### Scenario: 并发保护
- **WHEN** 上一次同步仍在进行时触发下一次调度
- **THEN** 跳过本次调度，不重复执行

