# ADR 0005: 深模块主机执行收敛与底层检索流水线纯粹化

## Status

Accepted

## Context

在 Memoria 现有的多智能体与基础设施交互体系中，存在两处显著的架构摩擦与职责泄露：

1. **Host 命令安全审查与审批流跨三层模块泄露**：
   - 主机运维工具（`run_host_command`）涉及高危命令拦截与人工审批（ADR-0003）。
   - 此前实现中，主编排器 `memoria/agents/engine.py`（`_execute_agent_tool_async` 与 `_execute_agent_tool`）内部硬编码了大量主机专属逻辑：读取主机安全配置、多度实例化 `CommandGuard`、调用 `HostApprovalManager` 挂起协程、更新数据库消息状态、传递与校验一次性 `authorization_token`。
   - 被调用的 `AgentHostTools.run_host_command` 与底层 `HostConnector.execute_command` 随后又重复实例化 `CommandGuard` 并再度校验 Token。
   - 结果：安全策略与审批挂起流程散落并穿透了三层模块，主编排器耦合了底层运维模块的私有实现细节。

2. **`Pipeline` 遗留僵尸对话回路造成认知与架构漂移**：
   - ADR-0002 已将单轮对话与 Agent 决策统一收敛至 `AgentEngine`，并明确要求 `Pipeline` 退回纯粹的底层摄取与检索基础设施。
   - 但 `Pipeline` 中依然残留了 360 余行遗留代码，包括 `query()`、`prepare_query()`、`query_stream()` 以及内嵌的主机工具 Schema 构造和执行（`_build_host_tools_schema`、`_execute_host_tool`）。
   - 当前生产接入点（Web SPA、OpenAI 协议接口 `/v1`、QQBot 通道及 CLI）已无任何一处调用这些方法，仅存少量陈旧单元测试在维护死代码。

## Decision

我们确立以下深模块重构方案：

### 1. 收敛深模块 Host Execution（主机执行全内聚）
- **内聚安全与审批生命周期**：将命令安全检查（`CommandGuard`）、审批等待（`HostApprovalManager`）、一次性授权 Token 生成与 SSH 客户端执行全部下沉收敛至 `AgentHostTools` / `memoria/connectors/host/` 内部。
- **回调解耦接缝（Callback Hook Seam）**：
  - `AgentHostTools.run_host_command_async(...)` 作为对编排层的唯一执行接缝。
  - 编排器 `AgentEngine` 仅向其注入可选的 `on_approval_required` 回调（负责将事件写入流式队列并标记 DB 状态）与 `on_approval_decision` 回调。
  - `AgentEngine` 彻底移除 `CommandGuard` 的多度导入与校验，不再传递或感知任何 `approval_token`，接口与实现显著精简。
  - 同步调用（如 CLI）不传递回调时，需要审批的非白名单命令直接安全拒绝（Fail-Closed），彻底避免同步死锁。

### 2. 彻底纯粹化底层检索流水线 (`Pipeline`)
- **纯删除僵尸对话方法**：完全删除 `memoria/core/pipeline.py` 中的 `query()`、`prepare_query()`、`query_stream()`、`_build_host_tools_schema()`、`_execute_host_tool()`、`_build_sources()` 及 `_persist_response()`。
- **收敛为纯粹 Retrieval & Ingest 模块**：
  - `Pipeline` 仅保留 `ingest()`、`delete_doc()`、`retrieve()` 三大核心无状态检索接口。
  - 解除对生成层 `LLMCaller` 的强依赖，将其置为可选并逐步淡出，移除对会话提示词（`default_system_prompt`）的无关状态绑定。
  - 同步精简并对齐单元测试，将原针对 `pipeline.query()` 的陈旧测试迁移或移除，让测试严格聚焦于向量与混合检索边界。

## Consequences

- **优点**:
  - **局部性（Locality）最大化**：主机安全审查、高危黑名单拦截与交互审批流完全内聚于主机连接器模块，修复与升级策略时无需触碰编排引擎。
  - **单向无泄漏接缝**：`authorization_token` 不再跨越模块边界泄露，主编排器回归纯净的调度与流式事件汇聚职责。
  - **消除概念分裂**：`Pipeline` 彻底成为纯粹的 RAG 摄取与混合检索引擎，与 `AgentEngine` 职责分明，杜绝代码库中的双重会话回路。
  - **删除测试通过（Deletion Test）**：消除了 500+ 行重复校验与死代码，接口复杂度大幅降低，提升 AI 可读性与系统可维护性。
- **成本与权衡**:
  - 移除了旧 `Pipeline.query` 直接调用能力，外部若有未声明的脚本需统一使用 `AgentEngine.run`。
