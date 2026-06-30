# Comet Design Handoff

- Change: show-vault-file-path
- Phase: design
- Mode: compact
- Context hash: 88b997874988a2f4644e4605b50b8d5d4cb86b0d85df463b3b38c3900dd03f21

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/show-vault-file-path/proposal.md

- Source: openspec/changes/show-vault-file-path/proposal.md
- Lines: 1-26
- SHA256: da0d9f62467b2ca4beaa92d63ec48a715c87a09a26f7d0727db495925efe42e0

```md
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
```

## openspec/changes/show-vault-file-path/design.md

- Source: openspec/changes/show-vault-file-path/design.md
- Lines: 1-52
- SHA256: 90a0ea19431fb08aece271d70a0ddc5ad96daf3b259237cdd55fce7f7e516919

```md
## 架构决策

### 1. Chroma metadata 扩展（不改 DB schema）

ingest 时在 Chroma metadata 中新增 `db_doc_id` 字段，存储 DB 文档 UUID。query 时从 metadata 取得 `db_doc_id`，反查 `db.get_doc()` 获取 `filename`、`path`、`source`，附加到 Source 响应。

**不选择替代方案**（在 Chroma 中直接存 filename/path）：反查 DB 更可靠，未来字段扩展只改 DB 即可，不需要重新 ingest。

### 2. vault doc.path 修正

`syncer._ingest_file()` 目前传入临时文件路径作为 path，导致 `documents.path` 存储无意义的 `/tmp/tmpXXXXX` 字符串。改为传入 `rel_path`，使 `documents.path` 成为 vault 内相对路径。

### 3. 旧数据降级处理

已存在的旧 vault 向量 metadata 中无 `db_doc_id`，`chroma_store.query()` 返回空字符串时，`pipeline.query()` 跳过 DB 反查，Source 中 `filename`/`path` 为 `null`，前端不显示路径行。重新 sync vault 后自动迁移。

### 数据流

```
ingest（vault）
  syncer._ingest_file(rel_path=rel_path)
    → pipeline.ingest(path=rel_path, filename=basename(rel_path))
    → doc = db.create_doc(filename=basename, path=rel_path, ...)
    → Chroma metadata: {doc_id: "...", db_doc_id: doc["id"]}

query
  Chroma → {text, score, doc_id, db_doc_id}
  db.get_doc(db_doc_id) → {filename, path, source}
  Source 响应: {text, score, doc_id, filename, path, source}

前端（Chat.tsx）
  source.source == "vault" → 显示 filename + path
  source.source == "upload" 或 null → 不显示路径

前端（KnowledgeBases.tsx）
  doc.source == "vault" → 文件名下方显示 doc.path
  doc.source == "upload" → 不显示路径
```

### API 变更

`Source` 接口新增可选字段：
```typescript
interface Source {
  text: string
  score: number
  doc_id: string
  filename?: string   // 新增
  path?: string       // 新增
  source?: string     // 新增（"upload" | "vault"）
}
```
```

## openspec/changes/show-vault-file-path/tasks.md

- Source: openspec/changes/show-vault-file-path/tasks.md
- Lines: 1-9
- SHA256: 4f7d9ae6aa1bf4241b654fbfd079cb2126b40226657424d0eba8b4fe78cd6ce5

```md
## Tasks

- [ ] `chroma_store.py`：`query()` 从 metadata 提取并返回 `db_doc_id`
- [ ] `pipeline.py`：ingest 时写 `db_doc_id` 到 Chroma metadata；query 时反查 DB 补充 `filename`/`path`/`source`
- [ ] `syncer.py`：`_ingest_file()` 传 `rel_path` 作为 path 参数
- [ ] `api.ts`：`Source` 接口增加 `filename?`、`path?`、`source?`
- [ ] `Chat.tsx`：vault 来源卡片显示 `filename` + `path`
- [ ] `KnowledgeBases.tsx`：vault 文档列表行显示 `path`
- [ ] 运行测试确认通过
```

