# Multi-Agent as Tool and Hierarchical Tracing

## Goal

将 Memoria 原有的平铺单 Agent 架构重构为基于 Agent-as-Tool 的层次化 Multi-Agent 架构（Orchestrator + KnowledgeAgent + HostAgent 等专业子 Agent），并在 Web 端与 CLI 终端全面支持层级 Tracing 可视化，使用户能够清晰感知当前是哪一个 Agent 正在思考、委派、调用工具或等待审批。

## Requirements

1. **Agent-as-Tool 多 Agent 体系**：
   - **Orchestrator（主调度 Agent）**：负责意图拆解、跨域规划、子 Agent 委派与最终答案整合，对下调用专业子 Agent 工具（如 `delegate_to_knowledge_agent`、`delegate_to_host_agent`）。
   - **KnowledgeAgent（知识库专家）**：专精于知识库元数据查询、文本/混合检索、相关度过滤与初筛，记录检索来源（`SourceCollector`）。
   - **HostAgent（主机运维专家）**：专精于主机信息探查、远程命令执行、错误排障与安全审批流程。
   - **安全与审批透传**：子 Agent 触发的高危命令审批请求能够直接透传至外层流式响应中，并在审批通过后由对应子 Agent 继续执行。

2. **层级 Tracing 协议升级**：
   - 在 Tracing Span 和流式事件（ndjson）中引入 `agent_id`、`agent_name`、`agent_role`、`parent_agent_id` 等元数据。
   - 明确区分顶层规划、子 Agent 委派、子 Agent 内部工具调用与思考。

3. **Web 端可视化适配**：
   - `web/src/pages/AgenticChat.tsx` 与 `api.ts` 适配多 Agent 结构，渲染不同的 Agent 身份徽章（如 🧠 Orchestrator、📚 KnowledgeAgent、🖥️ HostAgent）。
   - 时间线与 Trace 面板支持层次化嵌套展示，呈现清晰的“主 Agent 委派 ➔ 子 Agent 执行 ➔ 返回结果”调用树。

4. **CLI 控制台适配**：
   - 控制台输出具备彩色 Agent 标签和层级缩进指示。

## Acceptance Criteria

- [ ] 后端实现 Orchestrator、KnowledgeAgent、HostAgent 的 Agent-as-Tool 封装与调用。
- [ ] 流式事件与 Trace 记录中包含完整的 agent_id / agent_name / parent_agent_id 层级元数据。
- [ ] 审批流程在多 Agent 嵌套委派场景下正常工作。
- [ ] Web 前端成功展示多 Agent 徽章与层次化 Trace 视图，且前端构建成功更新到 memoria/static/。
- [ ] CLI 终端具备友好的多 Agent 追踪输出。
- [ ] 全量单元测试和集成测试通过。
