## Why

上传文件和聊天接口在 embedding/LLM 服务不可达时抛出未捕获的 `openai.APIConnectionError`，导致客户端收到 500 而非语义明确的 503。

## What Changes

- `memoria/server/routes/documents.py`：在 `pipeline.ingest()` 调用处捕获 `APIConnectionError`，返回 HTTP 503
- `memoria/server/routes/chat.py`：在 `pipeline.query()` 调用处捕获 `APIConnectionError`，返回 HTTP 503

## Capabilities

### New Capabilities
<!-- 无 -->

### Modified Capabilities
<!-- 无 spec-level 行为变更，仅错误处理改进 -->

## Impact

- 影响文件：`documents.py`、`chat.py`（各 1 处 try/except）
- 无接口变更，无依赖新增
- 客户端可依据 503 状态码区分服务不可达与其他错误
