# PRD: 独立 Agentic RAG 页面

## 背景

当前 Agentic RAG 入口被放在 Bot Chat 页面中，要求先选择 Bot，并且 Agent 只能访问该 Bot 绑定的知识库。这与产品目标不符：经典 Chat 面向固定 Bot 与固定知识库范围；Agentic RAG 应作为独立能力，默认可以在全部知识库中自主选择检索范围。

## 目标

1. 保留现有 `/chat` 经典 Bot Chat 页面及其行为不变。
2. 新增独立 Agentic RAG 页面与导航入口，不要求选择 Bot。
3. Agentic 引擎默认可访问系统内全部知识库，并通过工具自主发现和检索相关知识库。
4. Agentic 会话与 Bot 会话在 API、列表和数据归属上清晰隔离。
5. 前端可创建、切换、重命名、删除 Agentic 会话，并展示使用的知识库和结构化来源。

## 非目标

- 本任务不改变经典 `/api/chat/{bot_id}` 与 `/api/chat/{bot_id}/stream` 的请求和响应行为。
- 本任务不增加用户权限系统；当前单用户部署模型下“全部知识库”即数据库中的全部知识库。
- 本任务不要求 Agentic 首期支持流式输出。
- 本任务不要求在历史消息中展示 Agent 的内部推理过程，仅展示最终答案、使用的知识库和来源。

## 功能需求

### 独立页面与导航

- 新增页面路由，例如 `/agentic-chat`。
- 侧边栏新增“Agentic RAG”入口，与“对话”并列。
- 现有 `/chat` 页面移除 Agentic/Classic 模式选择器，恢复为纯经典 Bot Chat。

### Agentic API

提供不依赖 Bot 的接口：

- `POST /api/agent-chat`：提交消息，可选 `session_id`；服务端默认将全部知识库作为 Agent 可访问范围。
- `GET /api/agent-sessions`：列出 Agentic 会话。
- `GET /api/agent-sessions/{session_id}/messages`：读取 Agentic 会话消息。
- `PATCH /api/agent-sessions/{session_id}`：重命名 Agentic 会话。
- `DELETE /api/agent-sessions/{session_id}`：删除 Agentic 会话。

接口响应至少包含：`answer`、`session_id`、`used_kbs`、`sources`。Agentic source 应包含 `kb_id` 及已有来源字段。

### 会话隔离

- Agentic 会话不能依赖真实 Bot。
- 推荐在 sessions 表增加可空 `bot_id` 与 `session_type`（`bot`/`agentic`），或采用等价的兼容方案。
- 经典会话继续通过 `bot_id` 归属；Agentic 会话通过 `session_type=agentic` 归属。
- 通用消息读取、重命名、删除接口必须校验会话存在并保持现有经典兼容性。

### Agent 工具范围

- Agentic route 创建的 `AgentKnowledgeTools.allowed_kb_ids` 为数据库当前全部知识库 ID。
- Agent 不允许访问不存在的知识库。
- Agent 工具仍通过现有 Pipeline 检索，不能在路由中直接调用 OpenAI 或 Chroma。

### 前端交互

- 独立页面拥有自己的会话侧栏和新建会话按钮。
- 页面不显示 Bot 选择器。
- 输入消息后调用 typed API，显示非流式等待状态。
- Agentic assistant 消息显示 Agentic 标识、使用的知识库数量/ID，以及可展开的来源列表。
- Classic 页面不显示 Agentic 标识，不再调用 Agentic API。

## 验收标准

1. 从侧边栏点击 Agentic RAG 可进入独立页面，无需选择 Bot 即可发送消息。
2. Agentic 请求的工具可枚举并检索全部知识库；一个 Bot 未绑定的知识库也可被 Agent 使用。
3. Agentic 首次请求创建独立会话，后续请求可携带该 session 继续上下文。
4. Agentic 会话列表、消息读取、重命名和删除可用，且不会出现在某个 Bot 的会话列表中。
5. `/chat` 页面仍需选择 Bot，经典流式聊天与原有测试全部通过。
6. 前端 lint/build 通过；后端新增 API、会话隔离和全量知识库范围有自动化测试。
