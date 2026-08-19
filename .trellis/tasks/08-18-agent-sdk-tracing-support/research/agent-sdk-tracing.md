# Agent SDK tracing 支持调研

## 范围

- 项目依赖：`openai-agents==0.0.10`，见 `pyproject.toml` / `requirements.txt`。
- 当前使用位置：`memoria/agents/engine.py` 的 `OpenAIAgentsRunner.run()`。

## 代码观察

1. Memoria 当前主动关闭了 Agents SDK tracing：
   - `memoria/agents/engine.py` 从 `agents` 导入 `set_tracing_disabled`。
   - 随后调用 `set_tracing_disabled(True)`。

2. 已安装的 `agents` 包版本为 `0.0.10`，并导出 tracing API：
   - `set_tracing_disabled`
   - `set_tracing_export_api_key`
   - `add_trace_processor` / `set_trace_processors`
   - `trace` / `custom_span`
   - `agent_span` / `function_span` / `generation_span` / `response_span` / `handoff_span`
   - `get_current_trace` / `get_current_span`
   - `TracingProcessor`

3. `Runner.run()` 支持 `run_config: RunConfig`，其中 `RunConfig` 有 tracing 字段：
   - `tracing_disabled: bool = False`
   - `trace_include_sensitive_data: bool = True`
   - `workflow_name: str = "Agent workflow"`
   - `trace_id: str | None = None`
   - `group_id: str | None = None`
   - `trace_metadata: dict[str, Any] | None = None`

4. SDK 自己会在 Runner 内创建 trace / span：
   - `agents/run.py` 使用 `TraceCtxManager(...)` 包裹 run。
   - agent turn 会创建 `agent_span(...)`。
   - function tool 调用在 `agents/_run_impl.py` 里用 `function_span(...)` 包裹。
   - Chat Completions 模型调用在 `agents/models/openai_chatcompletions.py` 里用 `generation_span(...)` 包裹。

5. SDK 默认 tracing backend：
   - `agents/tracing/processors.py` 内置 `BackendSpanExporter`，默认 endpoint 是 `https://api.openai.com/v1/traces/ingest`。
   - 默认 exporter 使用 `OPENAI_API_KEY`，也支持 `set_tracing_export_api_key(...)` 设置。
   - SDK 还有 `ConsoleSpanExporter` 和 `TracingProcessor` / `TracingExporter` 接口，可自定义落地方式。

6. 未发现 OpenTelemetry / OTLP / Jaeger / Zipkin 相关内置依赖或导出器；如需对接 OTel，需要自定义 `TracingProcessor` / `TracingExporter` 做转换。

## 结论

可以。当前 SDK 本身已经具备 tracing 能力，不需要重写 agent loop。Memoria 当前只是显式禁用了它。

## 推荐接入形态

最小方案：

- 移除或改造 `set_tracing_disabled(True)`。
- 调 `Runner.run(agent, message, run_config=RunConfig(...))`：
  - `workflow_name="Memoria agentic chat"`
  - `group_id=session_id`
  - `trace_metadata={"session_id": session_id, "model": model_name, ...}`
  - 视隐私要求设置 `trace_include_sensitive_data=False`。

如果希望在 Memoria 后端/数据库/日志里看 tracing，而不是发到 OpenAI trace backend：

- 实现一个 `TracingProcessor` 或 `TracingExporter`。
- 使用 `set_trace_processors([...])` 或 `add_trace_processor(...)` 注册。
- 在 `on_trace_start/end`、`on_span_start/end` 中把 `trace.export()` / `span.export()` 写入目标存储。

## 风险与注意

- 默认 exporter 会发往 OpenAI tracing endpoint，不会走当前 `AsyncOpenAI(base_url=...)` 的兼容服务地址；如果当前 `openai_api_key` 实际是 DeepSeek/本地兼容 API key，默认上传通常不可用，建议自定义 processor 或单独配置 OpenAI tracing key。
- tracing 可能包含 prompt、tool 参数、模型输入/输出等敏感数据；可用 `trace_include_sensitive_data=False` 只保留结构性 span 信息。
- `set_tracing_disabled(...)` 是全局开关，建议避免在单次请求中全局反复切换；优先使用 `RunConfig(tracing_disabled=...)` 做 per-run 控制。

## Web 展示形态补充

当前 Web/后端只返回并展示 `sources` / `used_kbs`：

- `web/src/api.ts` 的 `AgentChatResponse` 包含 `answer`、`session_id`、`used_kbs`、`sources`。
- `web/src/pages/AgenticChat.tsx` 在 assistant 消息下方展示“使用知识库”和“检索依据”。
- 后端 `messages.sources` 只保存检索来源 JSON，没有 trace/span 存储。

如果只启用 SDK 默认 exporter，trace 会离开 Memoria 进 OpenAI tracing 后端，当前 Web 没有数据可展示。要在 Memoria Web 中展示，需要自定义 processor/exporter 把 trace/span 保存到本地，然后增加 API 和 UI。

推荐 Web 形态：在每条 agent assistant 消息下新增一个可折叠的“执行轨迹 / Trace”区域，按树或时间线展示：

- Trace 根：workflow 名、trace_id、session_id、总耗时、状态。
- Agent span：agent 名、轮次、handoff/tool 列表、耗时。
- Tool span：工具名，例如 `list_knowledge_bases`、`search_knowledge_base`，参数摘要、返回条数、耗时、错误。
- Generation span：模型名、请求耗时、token/usage、可选输入输出摘要。
- 详情抽屉：原始 span JSON，敏感内容默认隐藏，可配置显示。
