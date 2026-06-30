## Tasks

- [ ] `chroma_store.py`：`query()` 从 metadata 提取并返回 `db_doc_id`
- [ ] `pipeline.py`：ingest 时写 `db_doc_id` 到 Chroma metadata；query 时反查 DB 补充 `filename`/`path`/`source`
- [ ] `syncer.py`：`_ingest_file()` 传 `rel_path` 作为 path 参数
- [ ] `api.ts`：`Source` 接口增加 `filename?`、`path?`、`source?`
- [ ] `Chat.tsx`：vault 来源卡片显示 `filename` + `path`
- [ ] `KnowledgeBases.tsx`：vault 文档列表行显示 `path`
- [ ] 运行测试确认通过
