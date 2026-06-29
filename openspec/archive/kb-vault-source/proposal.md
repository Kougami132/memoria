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
