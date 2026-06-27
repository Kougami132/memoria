# rag-query Specification

## Purpose
TBD - created by archiving change implement-phase1-rag-core. Update Purpose after archive.
## Requirements
### Requirement: RAG 单轮问答
系统 SHALL 执行完整 RAG 流程：检索关联 KB → 拼接 context → 调用 LLM → 返回回答，响应包含 `sources` 字段。

#### Scenario: 正常单轮查询
- **WHEN** 调用 `POST /api/chat/{bot_id}`
- **THEN** 返回含 `answer`、`session_id`、`sources`（召回的 chunks，含 text/score/doc_id）的 JSON

#### Scenario: Bot 无关联 KB
- **WHEN** Bot 未关联任何 KB
- **THEN** `sources` 为空数组，仅凭 system_prompt 和问题调用 LLM，正常返回

### Requirement: Prompt 构建
系统 SHALL 将 Bot 的 `system_prompt`、检索到的 context chunks 和用户问题组装为标准 messages 列表后发送给 LLM。

#### Scenario: Prompt 包含 context
- **WHEN** 检索到 3 条 chunks
- **THEN** LLM 收到的 messages 包含 system 消息（含 context 文本）和 user 消息（原始问题）

