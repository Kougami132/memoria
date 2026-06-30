## ADDED Requirements

### Requirement: Vault CRUD
系统 SHALL 提供 REST API 管理 KB 绑定的 vault：创建（绑定）、查询、删除（解绑）。每个 KB 最多绑定一个 vault。

#### Scenario: 绑定本地 vault
- **WHEN** POST `/api/knowledge-bases/{kb_id}/vault` 传入 `{"type": "local", "local_path": "/path/to/vault"}`
- **THEN** 返回 201，vaults 表新增记录，触发全量扫描（异步），返回 vault 对象

#### Scenario: 绑定 WebDAV vault
- **WHEN** POST `/api/knowledge-bases/{kb_id}/vault` 传入 `{"type": "webdav", "webdav_url": "https://...", "webdav_username": "u", "webdav_password": "p"}`
- **THEN** 返回 201，凭证以明文存入 vaults 表，触发全量扫描（异步）

#### Scenario: 重复绑定
- **WHEN** POST `/api/knowledge-bases/{kb_id}/vault` 但该 KB 已有 vault
- **THEN** 返回 409，提示该知识库已绑定 vault

#### Scenario: 查询 vault
- **WHEN** GET `/api/knowledge-bases/{kb_id}/vault`
- **THEN** 返回当前绑定的 vault 信息（密码字段屏蔽为 `"***"`）；未绑定返回 404

#### Scenario: 解绑 vault
- **WHEN** DELETE `/api/knowledge-bases/{kb_id}/vault`
- **THEN** 返回 204，vault 记录删除，vault_files 记录删除，该 vault 产生的所有 docs 和 Chroma 向量一并删除

#### Scenario: 解绑不存在的 vault
- **WHEN** DELETE `/api/knowledge-bases/{kb_id}/vault` 但无绑定
- **THEN** 返回 404

### Requirement: Vault 数据模型
系统 SHALL 在 SQLite 中维护 `vaults` 和 `vault_files` 两张表。

#### Scenario: vaults 表结构
- **WHEN** 创建 vault
- **THEN** `vaults` 表写入：`id`（UUID）、`kb_id`（FK）、`type`（`local`/`webdav`）、`local_path`（nullable）、`webdav_url`（nullable）、`webdav_username`（nullable）、`webdav_password`（nullable）、`last_synced_at`（nullable）、`created_at`

#### Scenario: vault_files 表结构
- **WHEN** 同步时发现新文件
- **THEN** `vault_files` 表写入：`id`（UUID）、`vault_id`（FK）、`rel_path`（相对路径）、`file_hash`（SHA-256）、`doc_id`（FK to documents，nullable）、`synced_at`
