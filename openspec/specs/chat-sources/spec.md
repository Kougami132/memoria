# chat-sources Specification

## Purpose
TBD - created by archiving change web-ui-playground. Update Purpose after archive.
## Requirements
### Requirement: Chat 响应包含引用来源
`POST /api/chat/{bot_id}` 响应 SHALL 新增 `sources` 字段，包含本次 RAG 检索命中的 chunk 列表。

#### Scenario: 有检索结果时返回 sources
- **WHEN** RAG 检索到相关 chunks
- **THEN** 响应包含 `sources: [{text, score, doc_id}]`，按相关度降序排列

#### Scenario: 无检索结果时返回空列表
- **WHEN** Bot 未关联 KB 或检索无命中
- **THEN** 响应 `sources` 为空数组 `[]`，其他字段不受影响

