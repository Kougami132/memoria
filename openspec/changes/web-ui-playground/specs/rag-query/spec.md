## MODIFIED Requirements

### Requirement: RAG 单轮问答
系统 SHALL 执行完整 RAG 流程：检索关联 KB → 拼接 context → 调用 LLM → 返回回答，响应包含 `sources` 字段。

#### Scenario: 正常单轮查询
- **WHEN** 调用 `POST /api/chat/{bot_id}`
- **THEN** 返回含 `answer`、`session_id`、`sources`（召回的 chunks，含 text/score/doc_id）的 JSON

#### Scenario: Bot 无关联 KB
- **WHEN** Bot 未关联任何 KB
- **THEN** `sources` 为空数组，仅凭 system_prompt 和问题调用 LLM，正常返回
