# ADR 0003: 智能体工具矩阵演进与 WebAgent 专员化架构

## Status

Accepted

## Context

在 Memoria 现有的多智能体架构（ADR-0001、ADR-0002）中，`AgentEngine` 作为主编排器（Orchestrator），负责根据用户意图调度领域专家。现有系统仅接入了 `KnowledgeAgent` 与 `HostAgent`。

在实际使用场景（尤其是排查云服务器配置、查阅官方部署文档与排障）中，暴露出了以下痛点：
1. **外部公网文档缺失**：用户本地知识库往往没有收录最新软件版本的官方文档或排错手册，Agent 无法在未知配置项时联网检索。
2. **工具列表膨胀与上下文污染**：如果在主 Orchestrator 上直接挂载裸 Web 搜索与网页爬取工具，会导致主会话上下文被海量网页噪音挤爆，且违反了 ADR-0001 的 Agent-as-a-Tool 分层原则。
3. **现有工具存在冗余与盲区**：
   - `HostAgent` 的 `get_host_info` 仅读取静态配置，属于无意义的往返浪费；且缺乏限制输出长度的日志流工具，Agent 粗暴使用 `cat` 会撑爆上下文。
   - `KnowledgeAgent` 仅提供 Top-K 切片检索，当配置文件的切片上下文被截断时，Agent 无法追溯阅读整篇文档。

## Decision

我们确立以下工具矩阵分层演进方案：

### 1. 独立 WebAgent 专员 (`delegate_to_web_agent`)
- 维持 Orchestrator 的纯粹调度职责，不添加裸 `web_search` 或 `fetch_url` 工具。
- 新增 `WebAgent` 专员，负责公网搜索、网页清洗提取与多源信息浓缩，仅将高度精炼的总结与配置指导返回给主编排器。
- **配置与 Local-First 开关**：
  - 提供 `ENABLE_WEB_SEARCH` 配置。当用户关闭或处于纯离线环境时，主 Agent 的 Schema 中完全不挂载 `delegate_to_web_agent`，杜绝模型幻觉。
  - Provider 采用轻量免 Key 的 DuckDuckGo 作为开箱即用默认项，同时兼容 Tavily API 与自建 SearXNG。

### 2. 现有工具精简与深度扩充
- **HostAgent**:
  - **剔除**: 移除 `get_host_info` 独立 LLM 工具。主机的规格/操作系统等静态信息在向 HostAgent 下发任务时直接作为 Context 提示词注入。
  - **保留**: 保留受 `CommandGuard` 审批约束的 `run_host_command`。
  - **新增**: `read_host_log_tail(host_id: str, path: str, lines: int = 100)`，提供受保护的日志/文本查看能力，强制截断行数与字节数，防止上下文崩溃。
- **KnowledgeAgent**:
  - **保留**: 保留 `list_knowledge_bases` 与 `search_knowledge_base`。
  - **新增**: `read_knowledge_document(kb_id: str, doc_id: str, max_chars: int = 4000)`，允许 Agent 在切片信息不足时按需追溯整篇文档。
- **时间与通用环境感知**:
  - 不引入独立 Function Call 工具，在 `AgentEngine` 每次调用模型时动态在系统提示词中注入当前系统 ISO 时间与时区。

### 3. 工具矩阵一览

| 智能体层级 | 工具名称 (Tool Name) | 操作性质 | 功能描述 |
| :--- | :--- | :--- | :--- |
| **主 Orchestrator** | `delegate_to_knowledge_agent` | 只读委派 | 委派私有知识库检索与全篇追溯 |
| | `delegate_to_host_agent` | 读写受控委派 | 委派主机运维与排障（受 CommandGuard 审查） |
| | `delegate_to_web_agent` | 只读委派 | 委派公网资料、官方文档搜索与提炼（可选开关） |
| **HostAgent (内部)** | `run_host_command` | 执行操作 | 执行 shell 命今（危险命令人工审批） |
| | `read_host_log_tail` | 只读分析 | 安全读取远程文件/日志末尾指定行数（防爆截断） |
| **KnowledgeAgent (内部)** | `search_knowledge_base` | 语义检索 | 向量检索 Top-K 切片 |
| | `read_knowledge_document` | 全文读取 | 查看指定命中文档的全文/片段内容（防切片断裂） |
| **WebAgent (内部)** | `search_web` | 外部检索 | 检索公网网页标题与摘要 |
| | `fetch_web_page` | 提取提炼 | 提取正文内容并转化为纯净 Markdown |

## Consequences

- **优点**:
  - 严格保持了 ADR-0001 架构的一致性，主编排器职责单一，模型注意力不分散。
  - 彻底规避了主会话被大日志和网页垃圾信息撑爆的风险。
  - 完整兼顾了 Local-First 纯离线部署与需要公网查阅官方手册的混合场景。
- **限制**:
  - 知识库回写（Write-Back）因多端并发同步冲突暂时排除在当前矩阵之外，保持只读。
