## Context

Embedding API 拒绝空字符串输入（HTTP 400），`Embedder.embed()` 将其包装为 `RuntimeError`，由 chat/upload 路由捕获后返回 502。两处触发点：

1. `retrieve()` 直接用 `query` 调用 embed，若 `query=""` 即触发
2. `ingest()` 用 `chunks` 调用 embed，若文件为空或 chunker 产出空串即触发

## Goals / Non-Goals

**Goals**：在进入 embed 前拦截空输入，返回语义正确的响应（空结果或 422）

**Non-Goals**：不修改 Embedding API 调用方式，不改 Chunker 实现

## Implementation

```python
# retrieve()
def retrieve(self, kb_id, query, k=None):
    if not query or not query.strip():
        return []
    embedding = self._embedder.embed([query])[0]
    ...

# ingest()
def ingest(self, kb_id, path):
    chunks = Chunker().split(path)
    chunks = [c for c in chunks if c.strip()]   # 过滤空串
    if not chunks:
        raise ValueError("File produced no embeddable content")
    vectors = self._embedder.embed(chunks)
    ...
```
