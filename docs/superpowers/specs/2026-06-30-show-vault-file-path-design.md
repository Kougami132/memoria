---
comet_change: show-vault-file-path
role: technical-design
canonical_spec: openspec
---

# show-vault-file-path Design Doc

## 目标

vault 文件被命中为聊天参考来源时，显示原始文件名和 vault 内相对路径，让用户能定位源文件。知识库文档列表中 vault 文档也显示相对路径。

## 架构

### 1. Chroma metadata 扩展

ingest 时在每个 chunk 的 Chroma metadata 中新增 `db_doc_id` 字段：

```python
metadatas = [{"doc_id": doc_id, "db_doc_id": doc["id"]} for _ in chunks]
```

query 时从 metadata 取得 `db_doc_id`，反查 `db.get_doc()` 获取 `filename`、`path`、`source`。

**不选择「直接在 Chroma 中存 filename/path」**：字段变动时需重新 ingest；DB 反查走主键 O(1)，无性能影响。

### 2. vault doc.path 修正

`syncer._ingest_file()` 目前传入临时文件路径，导致 `documents.path` 存储无意义的 `/tmp/tmpXXXXX`。改为传入 `rel_path`：

```python
pipeline.ingest(vault["kb_id"], rel_path, source="vault",
                filename=os.path.basename(rel_path), tmp_path=tmp_path)
```

pipeline.ingest 签名相应调整，`path` 参数改为存入 DB 的逻辑路径，新增 `tmp_path` 参数用于实际文件读取。

### 3. 数据流

```
ingest（vault）
  syncer._ingest_file(rel_path)
    → pipeline.ingest(path=rel_path, filename=basename(rel_path), tmp_path=tmp_path)
    → doc = db.create_doc(filename=basename, path=rel_path, ...)
    → Chroma metadata: {doc_id: "...", db_doc_id: doc["id"]}

query
  ChromaStore.query() → {text, score, doc_id, db_doc_id}
  db_doc_id 非空 → db.get_doc(db_doc_id) → {filename, path, source}
  db_doc_id 为空（旧数据）→ 跳过，filename/path/source = null
  Source 响应: {text, score, doc_id, filename?, path?, source?}

前端（Chat.tsx）
  source.source == "vault" → 显示 path
  其他 → 不显示路径

前端（KnowledgeBases.tsx）
  doc.source == "vault" → 文件名下方显示 doc.path
  doc.source == "upload" → 不显示路径
```

### 4. API 变更

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

### 5. 旧数据降级

已存在的旧 vault 向量 metadata 无 `db_doc_id`，`ChromaStore.query()` 返回空字符串，`pipeline.query()` 跳过 DB 反查，Source 中 `filename`/`path`/`source` 为 `null`，前端不显示路径行，无报错。重新 sync vault 后自动迁移。

## 受影响文件

| 文件 | 改动 |
|------|------|
| `memoria/storage/chroma_store.py` | query 返回 `db_doc_id` |
| `memoria/core/pipeline.py` | ingest 写 `db_doc_id`；query 反查 DB；签名加 `tmp_path` |
| `memoria/vault/syncer.py` | 传 `rel_path` + `tmp_path` |
| `web/src/api.ts` | Source 加三个可选字段 |
| `web/src/pages/Chat.tsx` | vault 来源显示 path |
| `web/src/pages/KnowledgeBases.tsx` | vault 文档显示 path |

## 测试策略

补充以下测试：
- ingest 后 Chroma metadata 含 `db_doc_id`
- query 返回 Source 含 `filename`/`path`/`source`
- `db_doc_id` 缺失（旧数据）时降级返回 null 字段，不抛异常
