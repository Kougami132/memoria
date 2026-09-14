# ADR-0002: 统一单轮会话编排器 (Unified Turn Orchestrator)

## 状态
已接受 (Accepted)

## 上下文 (Context)
在当前架构中，Memoria 存在双重 RAG/执行回路分裂：
1. **多重问答与流式路由割裂**：
   - 存在遗留但仍被测试与部分路由使用的 `Pipeline.query()` 与 `prepare_query()`。
   - `memoria/server/routes/chat.py` 内部使用直接组装 Prompt 的内联流式逻辑 (`chat_stream`)。
   - `memoria/server/routes/openai.py` 实现了 700 多行的双轨制协议层，并在内部手写非流式与流式 SSE 循环。
   - `memoria/agents/engine.py` (AgenticRagEngine) 单独实现了一套基于 OpenAI Agents 协议的完整代理与工具执行机制。
2. **逻辑重复与边界污染**：
   - 协议适配层（如 OpenAI 兼容层、REST 路由层、QQBot 适配层）承担了过重的会话持久化、消息组装和流式组包逻辑，使得协议转换与核心会话编排混杂。

## 决策 (Decision)
重构并确立统一单轮编排模型：
1. **下沉单轮编排职责至核心引擎**：
   - 将 `AgenticRagEngine` 规范/确立为系统的统一单轮编排入口（Unified Turn Orchestrator）。
   - 支持统一处理 `bot_id` 作用域（绑定受限知识库与主机权限）与全局 Agent 编排，统一产出 Token 流、Thinking 思考流、工具调用事件流与最终完成事件。
2. **路由适配层回归“轻量适配”**：
   - `openai.py` 仅负责 OpenAI / Responses 协议与内部流式事件的协议映射，消除内联的手写会话拼接与双轨分支。
   - `routes/agent_chat.py` 统一作为 Web 前端与标准 REST 客户端的单轮流式/非流式代理调用入口，废弃或收敛旧版私有内联链路。
3. **保留并对齐基础 Pipeline**：
   - `Pipeline` 作为底层检索与向量摄取基础设施（Retrieval Engine），继续为 KnowledgeAgent / AgentTools 及离线 Ingest 提供核心支持，不再作为并行的业务对话上层入口。

## 影响 (Consequences)
- **正面影响**：
  - 会话流转、上下文持久化、工具调用追踪逻辑完全内聚，消除逻辑漂移。
  - Web UI、OpenAI 兼容接口、QQBot 适配器共享同一套 Agent 协同能力与 Thinking 思考流。
- **负面影响 / 成本**：
  - 需要重构现有 `routes/openai.py` 中过长的流式拼接逻辑。
  - 需要确保已有端到端 API 测试全面覆盖并保持向后兼容。
