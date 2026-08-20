# Design: Agent思维链与Trace总览显示Token统计

## 1. 后端设计
1. 在 OpenAIAgentsRunner.run_stream 中发起 LLM 调用时：
   - 增加参数 stream_options={"include_usage": True}。
   - 在遍历 async for chunk in stream: 时，检查 chunk.usage。
   - 生成结束时，将 usage 存入 gen_span["usage"] 和 gen_span["data"]["usage"]。
2. 汇总逻辑：
   - 在 _normalize_trace_payload 和 final_trace summary 中，累计 prompt_tokens、completion_tokens、total_tokens。

## 2. 前端设计
1. web/src/api.ts：
   - AgentTraceSummary 添加 total_tokens, prompt_tokens, completion_tokens。
   - AgentTraceSpan 添加 usage。
2. web/src/pages/AgenticChat.tsx：
   - 在 TraceSpanCard 中展示 generation span 的 Token 消耗。
   - 在外层 Trace 卡片 Header 中展示总 Token 数。
