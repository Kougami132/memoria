## Context

`documents.py` 和 `chat.py` 的路由处理函数调用 `pipeline.ingest()` / `pipeline.query()`，后者最终调用 OpenAI embedding/LLM API。当目标服务不可达时，`openai` SDK 抛出 `APIConnectionError`，FastAPI 未能捕获，直接以 500 响应。

## Goals / Non-Goals

**Goals:**
- `upload_document` 和 `chat` 在 AI 服务不可达时返回 HTTP 503 with 明确提示

**Non-Goals:**
- 不添加重试逻辑
- 不修改 embedder/pipeline 内部逻辑
- 不处理其他 openai 错误类型（超时、鉴权等）

## Decisions

**捕获位置：路由层**，而非 embedder/pipeline 层。
理由：pipeline 是纯业务逻辑，不应耦合 HTTP 语义；路由层负责将异常转换为 HTTP 响应，符合现有 `chat.py` 的 `ValueError → 404` 模式。

## Risks / Trade-offs

- `APIConnectionError` 覆盖连接被拒绝/DNS 解析失败/超时等场景，已足够精确
- 不捕获 `openai.AuthenticationError` 等其他错误，暂不处理（非本次 bug 范围）
