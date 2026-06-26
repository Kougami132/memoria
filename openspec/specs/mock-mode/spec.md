# mock-mode Specification

## Purpose
TBD - created by archiving change implement-phase1-rag-core. Update Purpose after archive.
## Requirements
### Requirement: Mock Embedder
当 `USE_MOCK=true` 时，系统 SHALL 使用 MockEmbedder 替代真实 Embedder，返回固定维度（1536）的随机向量，不发起任何 API 请求。

#### Scenario: Mock 模式下 ingest 成功
- **WHEN** `USE_MOCK=true`，调用 `ingest(kb_id, "doc.md")`
- **THEN** 完成切分和向量写入，不调用任何外部 API，函数正常返回

#### Scenario: 真实模式下使用真实 Embedder
- **WHEN** `USE_MOCK=false`（默认）
- **THEN** Embedder 使用 `settings.newapi_base_url` 和 `settings.newapi_api_key` 调用真实 API

### Requirement: Mock LLMCaller
当 `USE_MOCK=true` 时，系统 SHALL 使用 MockLLMCaller，`call()` 返回固定字符串 `"[mock response]"`，streaming 版本逐字符 yield，不发起任何 API 请求。

#### Scenario: Mock 模式下 query 返回固定回答
- **WHEN** `USE_MOCK=true`，调用 `query(bot_id, "任何问题")`
- **THEN** 返回 `answer="[mock response]"`，不调用外部 LLM API

### Requirement: 测试套件在 mock 模式下全部通过
系统 SHALL 在 `USE_MOCK=true` 环境下，`pytest tests/ -q` 全部通过，不依赖任何外部 API key 或网络连接。

#### Scenario: 无 API key 环境下测试通过
- **WHEN** 未设置 `NEWAPI_API_KEY`，设置 `USE_MOCK=true`，运行 `pytest tests/ -q`
- **THEN** 所有测试通过，退出码 0

