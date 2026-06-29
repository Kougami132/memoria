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
