# Brainstorm Summary

- Change: show-vault-file-path
- Date: 2026-06-30

## 确认的技术方案

扩展 Chroma metadata 携带 `db_doc_id`（DB 文档 UUID），ingest 时写入，query 时反查 DB 补充 `filename`/`path`/`source` 字段附加到 Source 响应。vault ingest 时 `doc.path` 改存 `rel_path`（替代无意义的 `/tmp/tmpXXXX` 临时路径）。前端按 `source` 字段判断是否显示路径。

## 关键取舍与风险

- 不在 Chroma 中直接存 filename/path：DB 反查更可靠，未来扩展只改 DB
- 旧向量无 `db_doc_id`：降级处理，不显示路径，不报错
- `db_doc_id` 缺失时跳过 DB 反查，性能无影响（主键 O(1) 查询）

## 测试策略

补充以下单元测试：
- ingest 后 Chroma metadata 含 `db_doc_id`
- query 返回 Source 含 `filename`/`path`/`source`
- `db_doc_id` 缺失时降级不抛异常

## Spec Patch

无
