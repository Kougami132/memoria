# ADR 0008: 系统全局设置职责正交化、多模型渠道平等化与 Vault 调度收敛

## Status

Accepted

## Context

在 Memoria 演进至全栈 TypeScript（ADR 0007）后，系统设置页面（`GeneralSettingsTab.tsx`）与底层模型管理存在以下几处职责混杂与概念割裂：

1. **API 与模型服务的职责混乱（三合一杂糅）**：原「API 与模型服务」卡片同时承载了：
   - 知识库专用向量嵌入服务（Embedding）：`openai_base_url`、`openai_api_key`、`embedding_model`。
   - 对话生成模型（LLM）：`llm_model`。
   - 外部客户端访问本系统的鉴权 Token：`external_api_token`。
   这导致用户误将外部客户端接入 Token 当作上游大模型密钥，且无法将向量嵌入与对话 LLM 分别指向不同厂商（例如本地 Ollama 负责向量化，DeepSeek / Claude 负责对话推理）。
2. **多模型渠道与默认模型的隐式强耦合与死结**：后端在 `db.syncDefaultProviderFromSettings()` 中，每次保存全局设置都会向 `model_providers` 强制覆盖生成名为 `"default"` 的渠道，导致设置页第一栏与第二栏展示出重复的配置项。且渠道管理此前缺乏在线编辑能力，修改已有渠道只能删了重配。
3. **Vault 笔记库同步配置的位置与能力脱节**：
   - 全局设置中孤立放置了一个「Vault 同步间隔（分钟）」输入框，而所有具体的 Vault 仓库绑定、路径配置、状态监控与手动触发全部在「知识库管理」页面（`/knowledge-bases`）。
   - 代码层面上，该间隔参数在后端实际上并未挂载真正的后台轮询定时器（缺少主动定时扫描）。

## Decision

我们决定对系统全局设置、多模型渠道治理与 Vault 笔记库调度进行彻底的职责正交化重构：

### 1. 拆除杂糅结构，系统设置 Tab 重组为职责清晰的六大模块
将系统设置的一级 Tab 重新编排，彻底消除“大杂烩”式的页面：
- **「模型服务 (Models)」**（新设独立 Tab）：建立统一的**模型厂商中心 (Provider Hub)**。
  - **厂商端点与密钥只配一次**：用户添加服务商（如 OpenAI、Anthropic、DeepSeek、硅基流动、本地 Ollama 等），填写一次 Base URL 与 API Key，并录入该厂商提供的模型列表。
  - **顶部「全局模型指派 (Global Assignments)」**：
    - **默认对话模型 (LLM)**：直接从所有厂商模型中下拉选择，并配置默认思考深度。
    - **向量嵌入模型 (Embedding)**：直接从厂商模型中下拉绑定，并附带即时连通性测试。
    - **彻底消除重复配置**：无论用户是“同一厂商跑对话与嵌入”还是“云端对话 + 本地 Ollama 嵌入”，均只需在厂商列表中维护，顶部一键指派即可。
- **「通用与安全 (General)」**：专注于系统通用基础属性，包含**系统通用提示词**、**外部 API 访问鉴权 Token (Bearer)** 与快捷接入调试示例、**系统数据跨机迁移与冷备份**。
- **「知识检索 (Knowledge)」**：整合 RAG 切片/余弦检索参数，并在下方内聚集成 **Vault 笔记库增量同步与索引调度**（全局轮询周期配置、后台定时器状态监控、一键触发全量扫描）。
- **「主机运维」** / **「联网搜索」** / **「QQ 机器人」**：各领域扩展配置保持不变。

### 2. 模型调用引擎的统一解耦与平滑回退
- 向量嵌入服务（`src/rag/embedder.ts`）优先从指派的 Provider（由 `embedding_provider` 与 `embedding_model` 绑定）获取端点与密钥；若未显式指定，平滑回退至全局 `embedding_base_url` / `embedding_api_key`，老版本数据 100% 兼容。
- 对话引擎直接通过 `default_provider` 与 `llm_model` 从统一的 Providers 注册表中解析模型定义。

### 3. 多模型渠道平等化与在线编辑能力
- 彻底废除 `syncDefaultProviderFromSettings` 隐式强行覆盖逻辑。
- 所有渠道统一在 `model_providers` 表中平等治理。
- 前端渠道列表为每个条目提供「编辑」弹窗，支持就地修改渠道名称、协议类型、Base URL、API Key（脱敏显示，留空不修改）以及可用模型列表。

### 4. Vault 笔记库同步管理收敛至「知识检索」Tab，并激活后台轮询器
- 在系统设置「知识检索」页面中直接呈现 Vault 自动增量同步策略（全局轮询周期修改、状态查看与一键全量扫描）。
- 同时在左侧「知识库」管理页面提供「定时同步调度」Popover，实现双向便捷管理。
- 在后端 `src/vault/syncer.ts` 中补齐后台串行定时轮询器（`VaultManager.startPolling()`），单个仓库异常自动熔断隔离，保障主进程稳定。

## Consequences

- **正向收益**：
  - 彻底消除了设置项“照镜子”式的重复困惑，概念边界极度清晰。
  - 用户可以灵活组合“本地 Ollama 嵌入 + 云端 Claude/DeepSeek 对话推理”的最佳本地优先架构。
  - 外部 API 访问安全配置不再引起概念误解，提供了开箱即用的接入体验。
  - 知识库页面闭环管理 Vault 同步，且后台增量同步真正落地运行。
