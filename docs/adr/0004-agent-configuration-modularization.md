# ADR 0004: 专家智能体配置与全局系统设置模块化解耦

## Status

Accepted

## Context

随着 Memoria 多智能体架构演进（ADR-0001、ADR-0002、ADR-0003）以及 QQ Bot 官方通道、受控主机运维、联网搜索等能力的持续并入，系统设置页面（`/settings`）逐渐演化为包含 8 大功能模块的长列表单体页面：
1. **认知负荷过重**：API Base URL、外部 Token 鉴权、模型选择测试、QQ Bot 凭据与白名单、RAG 核心检索算法、系统全局提示词、联网搜索提供商、Vault 同步与数据备份垂直堆叠在一个长页面中，用户寻找特定专员配置时需要反复长距离滚动。
2. **表单生命周期与提交耦合**：页面仅有一个全局「保存设置」按钮，修改任何一个模块均会将整个页面的所有表单状态合并打包向后端提交。这导致跨模块未提交的草稿相互污染，甚至因局部误操作产生意外覆盖。
3. **架构概念混淆**：Memoria 遵循 Orchestrator-Workers（编排者-专家专员）架构，底层基础设施与各专家（`KnowledgeAgent`、`HostAgent`、`WebAgent`）及通道网关（`QQBot`）具有严格的职责边界。前端交互界面的扁平堆叠未能在用户认知层体现系统的分层设计。

## Decision

我们确立以下设置项模块化解耦与生命周期隔离方案：

### 1. 二级分段 Tab 导航与深链接路由
- **路由注册**：在前端路由层同时注册 `/settings` 与 `/settings/:tab`。
- **深链接直达**：支持 `/settings` 默认落地全局基础，以及 `/settings/knowledge-agent`、`/settings/host-agent`、`/settings/web-agent`、`/settings/qq-bot` 直达各专员配置切片。
- **容错重定向**：访问非法或未注册的子路径（如 `/settings/unknown`）时，系统自动安全重定向回 `/settings`，杜绝白屏或异常。
- **现代化分段 Tab 栏**：在页面顶部提供带有各专员领域图标、中文标题与角色 Badge 的水平分段导航栏，与侧边栏保持单入口联动。

### 2. 保活挂载机制 (Keep-Alive)
- 采用 CSS 隐藏渲染（`hidden` / `block`）保活各切片组件实例。
- 当用户在不同 Tab 之间切换（例如从 HostAgent 查看黑名单切换至 KnowledgeAgent 调整 Top-K）时，组件树不卸载，未保存的文本草稿、异步连通性测试状态及加载状态均完整保留。

### 3. 独立表单生命周期与差量提交 (Differential Payloads)
- 每个配置切片具备独立的保存状态（`isSaving`、`saved`）与专属「保存配置」按钮。
- 保存时仅向后端提交该切片所属职责范围内的差量字段：
  - **全局基础 (General)**：仅提交 API Base URL、API Key / 外部 Token 变更、模型选型、系统通用提示词与 Vault 同步周期。
  - **知识检索 (KnowledgeAgent)**：仅提交 `top_k`、`min_score`、`chunk_size`、`chunk_overlap`。
  - **主机运维 (HostAgent)**：仅提交多行文本转换后的 `host_dangerous_patterns` 正则数组。
  - **联网搜索 (WebAgent)**：仅提交 `enable_web_search` 开关、服务商、密钥与端点。
  - **QQ 通道 (QQBot)**：仅向 `/api/settings/qq` 提交通道相关凭据、策略与白名单。
- 单大切片保存成功后仅局部失效对应 React Query 缓存，绝不冲刷其他切片正在编辑的草稿。

### 4. 切片业务增强
- **KnowledgeAgent 切片**：引入 `delegate_to_knowledge_agent` 机制说明，提供直达知识库管理的快捷入口。
- **HostAgent 切片**：提供 CommandGuard 审查红线与三级执行模式（只读/审批/自由）对照卡片，配备「恢复推荐黑名单」一键重置功能，提供直达主机管理的快捷入口。
- **WebAgent 切片**：在专员关闭时呈现显式的 Local-First 纯离线保护状态标识，开启后支持 DuckDuckGo 免密直连、SearXNG 私有端点与 Tavily/SerpAPI 凭据配置。
- **QQBot 切片**：轮询显示官方网关实时连接灯，支持 Tag 标签化白名单输入与审批流开关。

## Consequences

- **优点**:
  - **认知清晰**：配置项与系统 Multi-Agent 架构严格对齐，各专员配置职责一目了然。
  - **草稿安全**：保活机制与差量提交杜绝了多模块草稿交叉污染和覆盖风险。
  - **书签友好**：支持深链接直接跳转与浏览器前进后退，方便运维排障快速共享。
  - **向后兼容**：后端接口协议（`PUT /api/settings` 与 `PUT /api/settings/qq`）保持完全向前兼容。
- **限制**:
  - 各专家专员目前仍统一继承全局选定的大模型与嵌入模型，专员独立模型覆盖（Per-Agent Model Override）留待未来版本按需拓展。
