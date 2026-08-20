# Agent思维链与Trace总览显示Token统计

## Goal

在 Agent 思考与执行轨迹（Trace）中支持展示 LLM 调用的 Token 消耗详情，并在外层轨迹总览折叠框中展示当前轮次或流式输出中累计的总 Token 数量。

## Requirements

1. **后端 Token 捕获与聚合 (`memoria/agents/engine.py`)**:
   - 在 OpenAI Agent 调用 LLM 流式输出 (`chat.completions.create`) 时，启用 `stream_options={"include_usage": True}`。
   - 捕获流式块中的 `usage`（含 `prompt_tokens`、`completion_tokens`、`total_tokens`），并写入 `generation` span 的 `usage` 和 `data.output` 中。
   - 规范化 Trace 汇总统计 (`summary`)，计算并返回整体的 `total_tokens`、`prompt_tokens`、`completion_tokens`。
2. **前端类型与接口定义 (`web/src/api.ts`)**:
   - `AgentTraceSummary` 增加 `total_tokens`、`prompt_tokens`、`completion_tokens` 可选字段。
   - `AgentTraceSpan` 增加 `usage` 字段结构。
3. **前端 UI 显示 (`web/src/pages/AgenticChat.tsx`)**:
   - 在最外层的 Trace 折叠栏（包括历史消息与实时流式消息）头部右侧显示总 Token 统计徽章（如 `1,234 tokens`，带 Coins 图标及详细 Prompt/Completion hover 提示）。
   - 在每个单步 LLM generation 的 TraceSpanCard 头部显示单次 Token 徽章，展开后展示输入 (Prompt)、输出 (Completion)、总计 (Total) 明细。

## Acceptance Criteria

- [x] 后端 `OpenAIAgentsRunner` 正确捕获并上报 generation span 的 token usage 与 trace 汇总 token usage。
- [x] 前端 TypeScript 接口与组件正确解析并呈现 token 数据。
- [x] 前端构建 (`npm run build`) 和后端测试 (`pytest`) 全部通过。
