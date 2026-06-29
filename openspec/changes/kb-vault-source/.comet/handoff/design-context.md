# Comet Design Handoff

- Change: kb-vault-source
- Phase: design
- Mode: compact
- Context hash: a2df7cb7e9ce628dd336aa82caec452feea16ede5fd75d47097967b9e8e6cb90

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/kb-vault-source/proposal.md

- Source: openspec/changes/kb-vault-source/proposal.md
- Lines: 1-34
- SHA256: b7f748e56adcf93797e8f7b7af7d6cdec6aec8265c7eac8c9ff8ab442f9eb779

```md
## Why

知识库目前只支持手动逐文件上传，无法与本地文件夹或 WebDAV 端点（如 Obsidian vault）保持同步。用户需要一种方式将外部文件目录绑定到知识库，让文档保持自动更新。

## What Changes

- 为知识库引入 **Vault（仓库）** 来源类型：每个 KB 可绑定零或一个 vault
- Vault 支持两种连接方式：**本地文件夹**（local path）和 **WebDAV**（URL + 用户名 + 密码）
- 绑定后触发**全量扫描**，将所有支持格式文件（`.md`/`.txt`）录入 KB
- **手动同步**：前端提供"同步"按钮，触发增量扫描
- **后台轮询**：服务器每隔固定间隔（默认 15 分钟）自动同步所有活跃 vault
- 同步逻辑：新增文件 → ingest；内容变化 → 删除旧向量 + 重新 ingest；文件删除 → 删除对应 doc
- **解绑 vault = 删除**：解绑时清除该 vault 产生的所有 docs 和向量
- 连接中断不主动删除现有数据，保持最后同步状态

## Capabilities

### New Capabilities

- `vault-management`: Vault 的 CRUD 操作（创建、获取、解绑）、绑定到 KB、凭证存储（明文）
- `vault-sync`: 同步引擎——本地连接器、WebDAV 连接器、增量 diff（基于文件哈希）、手动触发 API、后台轮询调度

### Modified Capabilities

- `kb-management`: KB 详情接口新增 vault 信息字段
- `document-management`: 文档新增 `source` 字段，区分手动上传和 vault 来源；vault 来源文档不可手动删除

## Impact

- **DB**：新增 `vaults` 表（vault 元数据 + 连接信息）、`vault_files` 表（文件路径 + 内容哈希，用于变更检测）
- **API**：新增 `/api/vaults` CRUD 端点、`POST /api/vaults/{id}/sync` 手动同步端点
- **依赖**：新增 `webdavclient3`（WebDAV 连接）、`apscheduler`（后台轮询）
- **Pipeline**：复用现有 `ingest()` 和向量删除逻辑，无接口变更
- **前端**：KB 设置页新增 vault 绑定/解绑 UI；KB 列表/详情展示同步状态
```

## openspec/changes/kb-vault-source/design.md

- Source: openspec/changes/kb-vault-source/design.md
- Lines: 1-78
- SHA256: be808f84d663138e3add7e65892500b926066b2dd65a2adae3166ca408c3c614

```md
## Context

当前 KB 只支持手动逐文件上传，`documents` 表记录每个上传文件，`pipeline.ingest()` 处理切分和向量化。没有来源概念，也没有自动同步机制。

新增 vault 来源需要：一张 `vaults` 表存连接信息，一张 `vault_files` 表追踪同步状态，一个同步引擎处理 diff，一个后台调度器驱动轮询。

## Goals / Non-Goals

**Goals:**
- 本地文件夹和 WebDAV 两种连接方式
- 基于文件哈希的增量同步（新增/变更/删除）
- 手动触发 + 后台自动轮询
- 解绑时清除所有关联数据

**Non-Goals:**
- 凭证加密
- 实时文件系统监听（inotify/FSEvents）
- 一对多 vault 绑定
- 支持 .md/.txt 以外的格式

## Decisions

### D1: 变更检测使用文件内容哈希（SHA-256），而非 mtime

**选择**：SHA-256 内容哈希

**理由**：mtime 在 WebDAV 场景不可靠（服务器可能不返回或精度不足）；哈希统一了本地和 WebDAV 两种连接器的变更判定逻辑，避免双套机制。

**代价**：每次同步需读取文件内容计算哈希，比对比 mtime 慢；对超大文件有轻微性能影响。可接受，因为典型 Obsidian vault 文件都是文本。

### D2: WebDAV 使用 `webdavclient3` 库

**选择**：`webdavclient3`

**理由**：封装了 PROPFIND/GET，API 简洁；维护活跃。替代方案（自行用 `requests` 实现 PROPFIND XML 解析）成本高且易出错。

### D3: 后台调度使用 APScheduler（AsyncIOScheduler）

**选择**：APScheduler `AsyncIOScheduler`

**理由**：FastAPI 基于 asyncio，AsyncIOScheduler 直接在同一事件循环中运行，无需额外线程；支持 interval trigger；轻量不需要独立进程。替代方案（asyncio.create_task 自写轮询循环）需要手动处理异常恢复，不值得。

### D4: 同步任务为异步后台任务，绑定时触发初次全量扫描

**选择**：绑定 API 返回 201 后，用 `asyncio.create_task` 触发初次全量扫描；手动 sync 端点返回 202，后台执行。

**理由**：初次扫描可能耗时（大 vault），同步返回避免 HTTP 超时。

### D5: documents 表新增 `source` 字段区分来源

**选择**：`source` 列，值为 `"upload"` 或 `"vault"`

**理由**：最小改动，不影响现有上传流程；vault 来源文档禁止手动删除的逻辑可在 route 层用此字段判断。

### D6: KB 删除时级联清除 vault 数据

**选择**：在 `delete_kb()` DB 方法中扩展，级联删除 vault、vault_files，并清除 Chroma 向量。

**理由**：保持 KB 删除语义完整，不留孤立数据。

## Risks / Trade-offs

- **WebDAV 兼容性**：不同 WebDAV 服务器（Nextcloud、nginx-webdav、坚果云）行为差异较大。→ 以 Nextcloud 为主要测试目标；连接失败只记录日志不崩溃。
- **全量哈希计算性能**：大 vault（1000+ 文件）首次同步慢。→ MVP 接受；后续可加并发 ingest。
- **并发同步冲突**：多个 vault 同时同步可能争用 Chroma 写锁。→ APScheduler 的 `max_instances=1` 防止同一 vault 并发；不同 vault 间目前顺序执行。
- **明文凭证**：WebDAV 密码明文存 SQLite。→ 已知风险，用户接受；后续迭代加密。
- **临时文件清理**：WebDAV 下载的临时文件需保证清理。→ 使用 `tempfile.NamedTemporaryFile` 上下文管理器确保自动删除。

## Migration Plan

1. 启动时 DB 自动迁移：检查 `vaults`/`vault_files` 表是否存在，不存在则创建；`documents` 表检查 `source` 列，不存在则 ALTER TABLE 添加（默认值 `"upload"`）。
2. 现有数据无需迁移，`source` 列默认值覆盖所有旧记录。
3. 新依赖 `webdavclient3` 和 `apscheduler` 加入 `pyproject.toml` / `requirements.txt`。

## Open Questions

- 轮询间隔是否需要在前端/runtime settings 中可配置？MVP 建议固定 15 分钟，后续再加配置项。
- WebDAV 是否需要支持自签名证书（`verify_ssl=False`）？暂不处理，遇到需求再加。
```

## openspec/changes/kb-vault-source/tasks.md

- Source: openspec/changes/kb-vault-source/tasks.md
- Lines: 1-43
- SHA256: 519886ea875388f896e494316b67e7dda03345fde977fc965de0ed052f754e5d

```md
## 1. DB 迁移与数据模型

- [ ] 1.1 在 `storage/db.py` 新增 `VaultRow`（`vaults` 表）和 `VaultFileRow`（`vault_files` 表）SQLAlchemy 模型
- [ ] 1.2 `DocumentRow` 新增 `source` 列（默认 `"upload"`），启动时自动 `ALTER TABLE` 迁移旧数据库
- [ ] 1.3 在 `DB` 类中实现 vault CRUD 方法：`create_vault`、`get_vault_by_kb`、`delete_vault`，以及 `delete_kb` 的级联删除逻辑
- [ ] 1.4 在 `DB` 类中实现 vault_files 方法：`upsert_vault_file`、`list_vault_files`、`delete_vault_file`

## 2. 同步引擎

- [ ] 2.1 新建 `vault/connector.py`，定义 `VaultConnector` 抽象基类（`list_files() -> list[str]`、`read_file(rel_path) -> bytes`）
- [ ] 2.2 实现 `LocalConnector`：`os.walk` 遍历本地路径，过滤 `.md`/`.txt`，`read_file` 直接读文件
- [ ] 2.3 实现 `WebDAVConnector`：用 `webdavclient3` PROPFIND 列文件，`GET` 读内容；处理连接失败异常
- [ ] 2.4 新建 `vault/syncer.py`，实现 `VaultSyncer.sync(vault_id)`：拉取文件列表 → 计算 SHA-256 → 与 vault_files 对比 → 执行新增/更新/删除 → 更新 `last_synced_at`
- [ ] 2.5 同步时使用 `tempfile.NamedTemporaryFile` 缓存 WebDAV 内容，确保临时文件自动清理

## 3. 后台调度器

- [ ] 3.1 在 `server/app.py` 的 `lifespan` 中启动 `APScheduler AsyncIOScheduler`，注册 interval 任务（默认 15 分钟），服务停止时 shutdown
- [ ] 3.2 调度任务遍历所有 vault，调用 `VaultSyncer.sync()`；每个 vault 设 `max_instances=1` 防并发

## 4. API 路由

- [ ] 4.1 新建 `server/routes/vaults.py`，实现 `POST /knowledge-bases/{kb_id}/vault`（绑定，触发异步全量扫描）、`GET /knowledge-bases/{kb_id}/vault`（查询，屏蔽密码）、`DELETE /knowledge-bases/{kb_id}/vault`（解绑，级联删除）
- [ ] 4.2 在 `vaults.py` 实现 `POST /knowledge-bases/{kb_id}/vault/sync`（手动触发，返回 202）
- [ ] 4.3 在 `server/app.py` 注册 vaults router
- [ ] 4.4 修改 `routes/knowledge_bases.py`：KB 详情和列表响应中附加 vault 信息
- [ ] 4.5 修改 `routes/documents.py`：删除文档时检查 `source` 字段，vault 来源文档返回 409

## 5. 前端 UI

- [ ] 5.1 在 KB 详情/设置页新增 vault 绑定区域：显示当前绑定状态（未绑定/已绑定+类型+last_synced_at）
- [ ] 5.2 实现绑定表单：选择类型（local/WebDAV），local 填路径，WebDAV 填 URL+用户名+密码
- [ ] 5.3 实现解绑按钮（需确认对话框，提示将删除所有相关文档）
- [ ] 5.4 实现"立即同步"按钮，调用手动 sync 端点，显示加载状态
- [ ] 5.5 在 `web/src/api.ts` 新增 vault 相关 API 函数（createVault、getVault、deleteVault、syncVault）

## 6. 验证

- [ ] 6.1 本地 vault 全量同步：创建含 .md/.txt 文件的目录，绑定后验证文档被录入 KB
- [ ] 6.2 增量同步验证：修改文件内容后手动 sync，验证旧向量被替换
- [ ] 6.3 文件删除验证：删除源文件后 sync，验证对应 doc 被移除
- [ ] 6.4 解绑验证：解绑后确认 vault、vault_files、documents、Chroma 向量均清除
- [ ] 6.5 WebDAV 连接失败处理：填入错误 URL，确认同步失败不影响现有数据
```

## openspec/changes/kb-vault-source/specs/document-management/spec.md

- Source: openspec/changes/kb-vault-source/specs/document-management/spec.md
- Lines: 1-35
- SHA256: 4379e4ef54099a01ff67c1a64b89bbcd53021a0f6cb93bf82a3cb82a505a82a0

```md
## MODIFIED Requirements

### Requirement: 文档上传入库
系统 SHALL 接受 multipart 文件上传，保存到 `upload_dir`，并触发 `ingest()`。vault 来源的文档不可通过此接口上传（source 字段用于区分）。

#### Scenario: 上传 .md 文件
- **WHEN** POST `/api/knowledge-bases/{kb_id}/documents` 上传 .md 文件
- **THEN** 返回 201，文件保存成功，documents 表新增记录（`source: "upload"`），Chroma 完成向量化

#### Scenario: 上传不支持的格式
- **WHEN** POST `/api/knowledge-bases/{kb_id}/documents` 上传 .pdf 文件
- **THEN** 返回 422，提示不支持该文件格式

#### Scenario: 上传到不存在的知识库
- **WHEN** POST `/api/knowledge-bases/nonexistent/documents` 上传文件
- **THEN** 返回 404

### Requirement: 文档列表与删除
系统 SHALL 同时支持按 KB 路径和按查询参数两种方式列出文档；vault 来源文档不允许手动删除。

#### Scenario: 列出文档（按 KB 路径）
- **WHEN** GET `/api/knowledge-bases/{kb_id}/documents`
- **THEN** 返回该 KB 下所有文档信息（JSON 数组），每个文档包含 `source` 字段（`"upload"` 或 `"vault"`）

#### Scenario: 列出文档（按查询参数）
- **WHEN** GET `/api/documents?kb_id={kb_id}`
- **THEN** 返回该 KB 下所有文档信息

#### Scenario: 删除手动上传文档
- **WHEN** DELETE `/api/documents/{doc_id}` 且该文档 source 为 `"upload"`
- **THEN** 返回 204，documents 表记录和 Chroma 中对应的 chunk 向量均被删除

#### Scenario: 删除 vault 来源文档
- **WHEN** DELETE `/api/documents/{doc_id}` 且该文档 source 为 `"vault"`
- **THEN** 返回 409，提示 vault 来源文档不可手动删除，需通过解绑 vault 操作
```

## openspec/changes/kb-vault-source/specs/kb-management/spec.md

- Source: openspec/changes/kb-vault-source/specs/kb-management/spec.md
- Lines: 1-24
- SHA256: 265639303ee9857fb9478e6fafa707cf7529ed7b1fd60069f80016b87220aeb2

```md
## MODIFIED Requirements

### Requirement: 知识库 CRUD（REST API）
系统 SHALL 提供 POST/GET/DELETE `/api/knowledge-bases` 端点管理知识库。

#### Scenario: 创建知识库
- **WHEN** POST `/api/knowledge-bases` 传入 `{"name": "简历", "description": "..."}`
- **THEN** 返回 201，含新建 KB 的 `id`、`name`、`description`、`created_at`

#### Scenario: 列出所有知识库
- **WHEN** GET `/api/knowledge-bases`
- **THEN** 返回 200，含所有 KB 的列表，每个 KB 包含 `vault`（绑定的 vault 摘要或 null）

#### Scenario: 获取知识库详情
- **WHEN** GET `/api/knowledge-bases/{kb_id}`
- **THEN** 返回 200，含该 KB 信息、文档列表，以及绑定的 vault 信息（含 `type`、`last_synced_at`，密码屏蔽）

#### Scenario: 删除知识库
- **WHEN** DELETE `/api/knowledge-bases/{kb_id}`
- **THEN** 返回 204，SQLite 中的 KB 记录、关联 vault、vault_files、documents 和 Chroma collection 均被删除

#### Scenario: 删除不存在的知识库
- **WHEN** DELETE `/api/knowledge-bases/nonexistent`
- **THEN** 返回 404
```

## openspec/changes/kb-vault-source/specs/vault-management/spec.md

- Source: openspec/changes/kb-vault-source/specs/vault-management/spec.md
- Lines: 1-39
- SHA256: aee912400149ea0469038574a730c78cc6250c9a5bab9b320b25a4b9cfee51c5

```md
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
```

## openspec/changes/kb-vault-source/specs/vault-sync/spec.md

- Source: openspec/changes/kb-vault-source/specs/vault-sync/spec.md
- Lines: 1-61
- SHA256: edfbc0d7f9fbbf9961db18a2fb4c122f6530f577735d6ac37311065616ad3e3d

```md
## ADDED Requirements

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
```

