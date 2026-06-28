## Why

两个已知缺陷影响核心功能：知识库文档上传后前端无法展示，以及对话 502 错误缺少足够日志导致难以排查根因。

## What Changes

- 在 `documents.py` 添加 `GET /knowledge-bases/{kb_id}/documents` 路由，与已有 POST 对齐，使前端 `listDocs()` 能获取正确的 JSON 响应
- 在 `chat.py` 的 502 捕获分支添加 `logger.error` 记录完整异常信息，便于排查间歇性 LLM/Embedding 失败

## Capabilities

### New Capabilities
<!-- 无新能力引入 -->

### Modified Capabilities
- `document-management`: 补充 GET `/knowledge-bases/{kb_id}/documents` 端点要求（原 spec 只描述了上传和删除）
- `kb-management`: 无行为变更，仅实现修复

## Impact

- `memoria/server/routes/documents.py`：新增 1 个 GET 路由
- `memoria/server/routes/chat.py`：新增 1 行 logger.error 调用
