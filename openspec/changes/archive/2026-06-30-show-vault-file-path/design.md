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
