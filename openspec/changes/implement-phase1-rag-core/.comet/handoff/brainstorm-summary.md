# Brainstorm Summary

- Change: implement-phase1-rag-core
- Date: 2026-06-26

## 确认的技术方案

### Pipeline 架构
`Pipeline` 类封装 db/embedder/llm/chroma_stores，`deps.py` 提供 `get_pipeline()` FastAPI 依赖。
测试时通过 `app.dependency_overrides` 替换整个 Pipeline 实例。

### ChromaStore 管理
Pipeline 内懒加载 dict 缓存：`_stores: dict[str, ChromaStore]`，按 kb_id 按需初始化。

### Chunk 删除策略
ingest 时每个 chunk 写入 Chroma metadata `{"doc_id": doc_id}`；
delete_doc 时用 `where={"doc_id": doc_id}` 过滤删除，不依赖 chunk_count。

### Prompt 构建格式
```
messages = [
  {"role": "system", "content": "{system_prompt}\n\n参考资料：\n{context}"},
  ...历史消息（最近10条，按原始 role 顺序）...
  {"role": "user", "content": "当前问题"}
]
```

## 关键取舍与风险

- ChromaStore 懒加载缓存：Phase 1 单进程无并发问题；多进程时需外部化缓存
- delete_doc 一致性：先删 Chroma，再删 SQLite；失败时记录错误不回滚（Phase 1 可接受）
- MockEmbedder 随机向量：每次 embed 结果不同，检索结果无语义意义，仅验证流程通畅

## 测试策略

- conftest.py 提供内存 SQLite DB fixture + MockPipeline fixture
- FastAPI TestClient 通过 `app.dependency_overrides` 注入 mock 依赖
- 所有测试使用 MockEmbedder + MockLLMCaller，`USE_MOCK=true`，无需真实 API

## Spec Patch

无（以上均为实现细节，不影响需求级行为）
