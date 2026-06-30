---
change: show-vault-file-path
design-doc: docs/superpowers/specs/2026-06-30-show-vault-file-path-design.md
base-ref: 2aef85c4448fd012ff523b5b7c3daf8867e94fa3
---

# 实施计划：show-vault-file-path

## 任务 1：`chroma_store.py` — query 返回 `db_doc_id`

**目标**：`ChromaStore.query()` 从 metadata 提取并返回 `db_doc_id` 字段。

**步骤**：
1. 在 `query()` 返回列表的每个 dict 中加入 `"db_doc_id": meta.get("db_doc_id", "")`

**测试**：补充 `test_chroma_store_returns_db_doc_id`：ingest 时 metadata 含 `db_doc_id`，query 返回结果中该字段存在。

---

## 任务 2：`pipeline.py` — ingest 写 `db_doc_id`，query 反查 DB，签名加 `tmp_path`

**目标**：
- `ingest()` 签名新增 `tmp_path: str | None = None`；若提供 `tmp_path` 则用它读取文件（Chunker），否则用 `path`；`path` 存入 DB（逻辑路径）
- ingest Chroma metadata 加入 `db_doc_id: doc["id"]`
- `query()` 取 `db_doc_id`，反查 `db.get_doc()`，Source 增加 `filename`/`path`/`source` 字段

**步骤**：
1. `ingest()` 签名：`path` 为逻辑路径（存 DB），`tmp_path` 为实际读取路径（可选）
2. `chunker_path = tmp_path or path`，Chunker 使用 `chunker_path`
3. `metadatas = [{"doc_id": doc_id, "db_doc_id": doc["id"]} for _ in chunks]`
4. `query()` 中：`db_doc_id = c.get("db_doc_id", "")`；若非空则 `doc_info = self.db.get_doc(db_doc_id)`；Source 加 `filename`/`path`/`source`（doc_info 为 None 时为 null）

**测试**：
- ingest 后 Chroma metadata 含 `db_doc_id`
- query 返回 Source 含 `filename`/`path`/`source`
- `db_doc_id` 为空时降级，Source 三字段为 null，不抛异常

---

## 任务 3：`syncer.py` — 传 `rel_path` + `tmp_path`

**目标**：`_ingest_file()` 中，`pipeline.ingest()` 的 `path` 参数改为 `rel_path`，新增 `tmp_path=tmp_path`。

**步骤**：
1. `result = self.pipeline.ingest(vault["kb_id"], rel_path, source="vault", filename=os.path.basename(rel_path), tmp_path=tmp_path)`

**测试**：确认 syncer 调用后 `doc.path == rel_path`。

---

## 任务 4：`api.ts` — Source 接口扩展

**目标**：`Source` 增加三个可选字段。

**步骤**：
```typescript
export interface Source {
  text: string
  score: number
  doc_id: string
  filename?: string
  path?: string
  source?: string
}
```

---

## 任务 5：`Chat.tsx` — vault 来源显示 path

**目标**：`SourceList` 中，当 `s.source === "vault"` 且 `s.path` 存在时，在卡片中显示路径。

**步骤**：
在现有 `<span className="font-mono text-muted-foreground truncate">{s.doc_id}</span>` 下方添加：
```tsx
{s.source === 'vault' && s.path && (
  <span className="text-xs text-muted-foreground/70 font-mono truncate">{s.path}</span>
)}
```

---

## 任务 6：`KnowledgeBases.tsx` — vault 文档列表显示 path

**目标**：文档列表中 vault 文档的文件名下方显示 `doc.path`。

**步骤**：找到文档列表渲染位置，在文件名后加：
```tsx
{doc.source === 'vault' && doc.path && (
  <div className="text-xs text-muted-foreground/70 font-mono truncate">{doc.path}</div>
)}
```

---

## 任务 7：运行测试确认通过
