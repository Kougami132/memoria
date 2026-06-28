## 1. 修复路由错误处理

- [x] 1.1 `documents.py`：在 `pipeline.ingest()` 调用处捕获 `openai.APIConnectionError`，抛出 HTTP 503
- [x] 1.2 `chat.py`：在 `pipeline.query()` 调用处捕获 `openai.APIConnectionError`，抛出 HTTP 503

## 2. 验证

- [x] 2.1 运行现有测试套件，确认无回归
