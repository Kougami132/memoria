## Why

当 vault 文件被命中为聊天参考来源时，UI 只显示一个不透明的 `doc_id` 字符串，用户无法得知这条内容来自 vault 的哪个文件。知识库文档列表也没有显示 vault 文件的相对路径。本次变更让用户在看到参考来源或浏览文档列表时，能清楚定位源文件在 vault 中的位置。

## What Changes

- `chroma_store.py`：`query()` 从 metadata 返回 `db_doc_id` 字段
- `pipeline.py`：ingest 时将 DB 文档 UUID 写入 Chroma metadata；query 时用 `db_doc_id` 反查 DB，将 `filename`、`path`、`source` 附加到 Source 响应；vault ingest 时 `doc.path` 改存 `rel_path`（替代无意义临时文件路径）
- `vault/syncer.py`：ingest 调用时传入 `rel_path` 作为 path 参数
- `api.ts`：`Source` 接口增加可选字段 `filename?`、`path?`、`source?`
- `Chat.tsx`：vault 来源卡片显示 `filename` + `path`；upload 来源行为不变
- `KnowledgeBases.tsx`：vault 文档列表行显示 `path`（即 rel_path）；upload 文档不显示路径

## Capabilities

### New Capabilities
无

### Modified Capabilities
无（展示层增强，不改变已有规格的验收场景）

## Impact

- 受影响文件：6 个（`pipeline.py`、`chroma_store.py`、`syncer.py`、`api.ts`、`Chat.tsx`、`KnowledgeBases.tsx`）
- 已存在的旧 vault 向量缺少 `db_doc_id` metadata，查询时优雅降级（不显示路径）；重新 sync 后自动更新
- 上传文件路径无意义，不显示路径，行为不变
