## ADDED Requirements

### Requirement: 向量相似度检索
系统 SHALL 对给定 `kb_id` 和 `query` 文本执行向量相似度检索，返回 top-k 文本片段及相似度分数。

#### Scenario: 正常检索
- **WHEN** 调用 `retrieve(kb_id, "问题", k=5)`，且该 KB 已有向量数据
- **THEN** 返回最多 5 条 `{"text": ..., "score": ..., "doc_id": ...}` 结果，按相似度降序排列

#### Scenario: 空知识库检索
- **WHEN** 调用 `retrieve(kb_id, "问题")`，且该 KB 无任何向量数据
- **THEN** 返回空列表，不抛出异常

### Requirement: 多 KB 合并检索
`query()` 函数 SHALL 对 Bot 关联的所有 KB 分别执行 `retrieve()`，合并结果后取综合得分最高的 top-k 条。

#### Scenario: 多 KB 合并
- **WHEN** Bot 关联 2 个 KB，调用 `query(bot_id, "问题")`
- **THEN** 两个 KB 各自检索，结果合并后按分数排序，取前 `top_k` 条作为 context
