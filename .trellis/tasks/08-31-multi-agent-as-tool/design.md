# Technical Design: Multi-Agent as Tool and Hierarchical Tracing

## 1. Architecture Overview

```
                      ┌──────────────────────────────┐
                      │    Client (Web UI / CLI)     │
                      └──────────────┬───────────────┘
                                     │ Stream (ndjson) / REST
                                     ▼
                      ┌──────────────────────────────┐
                      │       OrchestratorAgent      │
                      │  (Global Planning & Summary) │
                      └──────────────┬───────────────┘
                                     │
           ┌─────────────────────────┴─────────────────────────┐
           │ (Agent-as-Tool)                                   │ (Agent-as-Tool)
           ▼                                                   ▼
┌─────────────────────────────┐                     ┌─────────────────────────────┐
│       KnowledgeAgent        │                     │          HostAgent          │
│   (RAG Specialist Agent)    │                     │   (Ops Specialist Agent)    │
├─────────────────────────────┤                     ├─────────────────────────────┤
│ • list_knowledge_bases      │                     │ • list_hosts                │
│ • search_knowledge_base     │                     │ • get_host_info             │
│ • SourceCollector recording │                     │ • run_host_command          │
│                             │                     │ • Approval event bubbling   │
└─────────────────────────────┘                     └─────────────────────────────┘
```

## 2. Component Design

### 2.1 Backend (`memoria/agents/`)
- `KnowledgeAgent`:
  - 包装为 `delegate_to_knowledge_agent(query: str, target_kb_ids?: list[str]) -> str`
  - 接收查询请求，自动调度 `list_knowledge_bases` / `search_knowledge_base`，提炼后返回给主调度，同时向 `SourceCollector` 注册 Chunk。
- `HostAgent`:
  - 包装为 `delegate_to_host_agent(instruction: str, host_id?: str) -> str`
  - 接收运维指令，自动探查主机或执行命令，处理安全性与审批信号，返回精炼摘要。
- `OrchestratorAgent`:
  - 顶层 Agent，仅暴露子 Agent 工具。
  - 保留向后兼容能力（如果无主机且只有 KB 时可走轻量路由或直接代理）。

### 2.2 Hierarchical Tracing
- `AgentTraceSpan` 扩充字段：
  - `agent_id`: `'orchestrator' | 'knowledge_agent' | 'host_agent' | string`
  - `agent_name`: `'Orchestrator' | 'KnowledgeAgent' | 'HostAgent' | string`
  - `agent_role`: `'orchestrator' | 'specialist'`
  - `parent_agent_id`: `'orchestrator' | null`
- 流式事件：
  - `agent_start` / `agent_end`
  - `tool_start` / `tool_end`（带 `agent_id`）
  - `thought`（带 `agent_id`）

### 2.3 Web UI (`web/src/pages/AgenticChat.tsx` & `web/src/api.ts`)
- 徽章系统：不同 Agent 展现专属 Badge（图标 + 颜色 + 角色说明）。
- 时间线 / Trace 面板：支持按 Agent 嵌套层级展开 / 折叠。

### 2.4 CLI (`memoria/cli/`)
- 命令行支持多 Agent 彩色标签前缀输出。
