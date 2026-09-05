# 模型不可用时各接入端错误处理与用户提示

## Goal

当 LLM 模型服务连接成功但模型不可用（如 API Key 无效/欠费、模型不存在、上游服务 5xx、超时断连等）时，确保 QQBot、OpenAI 兼容 API、Agent Chat API 及 Web 前端均能够捕获错误并向用户提供明确的错误提示，避免出现静默无响应或假死现象。

## Requirements

- **QQBot 异常响应兜底**：
  - 当 `run_stream` 流中产生 `type: error` 事件时，QQBot 必须将错误详情转化为对用户的友好回复（如“抱歉，模型调用失败：...”），并通过 `send_message` 发送回 QQ 用户/群聊。
  - 当消息处理过程抛出未捕获异常或模型返回空内容时，提供明确的兜底回复，并在数据库事件日志中记录 `MSG_ERROR`。
- **核心 AgenticRagEngine 流式处理规范**：
  - 当 `runner.run_stream` 发生错误并产生 `type: error` 时，不应在后续继续抛出虚假的 `type: done` 事件，避免下游误判为正常完成。
- **API 服务端错误规范**：
  - `memoria/server/routes/openai.py`：流式与非流式调用在遇到模型不可用错误时，正确记录 502/503 状态码与结构化错误响应，流式错误后终止数据流。
  - `memoria/server/routes/chat.py` 与 `agent_chat.py`：对模型服务不可用（`APIConnectionError`, `APIStatusError`, `APIError`）进行统一规范的状态码与错误描述处理。
- **Web 前端体验保障**：
  - `web/src/pages/AgenticChat.tsx` 与 `Chat.tsx`：收到 `type: error` 事件时立即停止流式读取并保持错误横幅提示，退出加载状态，避免被后续事件覆盖。

## Acceptance Criteria

- [x] QQBot 在模型不可用（流中抛出 error 事件或处理异常）时，能够正常向 QQ 发送报错回复，并在数据库日志中记录对应事件。
- [x] `engine.run_stream` 在发生 error 时不发出 `done` 事件。
- [x] API 接口（`/v1/chat/completions`、`/v1/responses`、`/chat`、`/agent-chat`）在模型不可用时返回规范的 HTTP 错误状态码（502/503）或 SSE 错误数据块，并正确记录日志。
- [x] Web 前端在流式响应中遇到 error 事件时能够正确中断流并展示错误横幅，不被冲刷清空。
- [x] 单元测试与集成测试覆盖并通过。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
