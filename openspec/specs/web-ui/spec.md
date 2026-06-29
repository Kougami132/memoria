# web-ui Specification

## Purpose
TBD - created by archiving change web-ui-playground. Update Purpose after archive.
## Requirements
### Requirement: 静态前端挂载
FastAPI 应用 SHALL 将编译后的 React 静态文件挂载到根路径，API 路径 `/api/*` 优先匹配，其余路径返回 `index.html`。

#### Scenario: 访问根路径
- **WHEN** 用户访问 `http://localhost:8000/`
- **THEN** 返回 `index.html`，前端应用正常加载

#### Scenario: API 路由不受影响
- **WHEN** 请求 `/api/health`
- **THEN** 返回 JSON 响应，不被静态文件处理拦截

### Requirement: 知识库管理页
Web UI SHALL 提供知识库的创建、列表展示和删除功能，以及向指定 KB 上传文档（.md/.txt）、查看文档列表、删除文档的功能。

#### Scenario: 创建知识库
- **WHEN** 用户填写名称并提交
- **THEN** 调用 `POST /api/knowledge-bases`，列表刷新显示新条目

#### Scenario: 上传文档
- **WHEN** 用户选择文件并上传到某 KB
- **THEN** 调用 `POST /api/knowledge-bases/{kb_id}/documents`，成功后显示 chunk 数量

#### Scenario: 删除文档
- **WHEN** 用户点击文档的删除按钮并确认
- **THEN** 调用 `DELETE /api/documents/{doc_id}`，文档从列表移除

### Requirement: Bot 管理页
Web UI SHALL 提供 Bot 的创建、编辑、删除功能，支持关联多个 KB 和配置 system_prompt。

#### Scenario: 创建 Bot
- **WHEN** 用户填写名称、system_prompt，选择关联 KB 后提交
- **THEN** 调用 `POST /api/bots`，Bot 列表刷新

#### Scenario: 编辑 Bot
- **WHEN** 用户修改 Bot 的 system_prompt 或关联 KB 并保存
- **THEN** 调用 `PUT /api/bots/{bot_id}`，展示更新后内容

### Requirement: 对话页
Web UI SHALL 提供选择 Bot、创建/切换会话、发送消息、查看回答及引用片段的能力。assistant 消息 SHALL 以 Markdown 格式渲染，user 消息以纯文本渲染。

#### Scenario: 新建会话
- **WHEN** 用户选择 Bot 并点击"新建会话"
- **THEN** 发送不带 `session_id` 的请求，响应中的 session_id 记录为当前会话

#### Scenario: 切换历史会话
- **WHEN** 用户从会话列表选择历史会话
- **THEN** 调用 `GET /api/bots/{bot_id}/sessions` 获取列表，切换后加载该 session 的历史消息

#### Scenario: 查看引用来源
- **WHEN** 收到 Chat API 响应
- **THEN** 在回答下方展示 `sources` 列表，每条显示 doc_id 和相关文本片段

#### Scenario: assistant 消息 Markdown 渲染
- **WHEN** 收到包含 Markdown 格式的 assistant 消息
- **THEN** 消息气泡中正确渲染 Markdown（加粗、列表、代码块等），不显示字面符号

### Requirement: 设置页
Web UI SHALL 提供运行时配置的查看和修改入口，字段包括 openai_base_url、api_key、embedding_model、llm_model、top_k、chunk_size、chunk_overlap。

#### Scenario: 加载当前配置
- **WHEN** 用户进入设置页
- **THEN** 调用 `GET /api/settings`，展示当前生效值（覆盖值或环境变量值）

#### Scenario: 修改并保存配置
- **WHEN** 用户修改字段并点击保存
- **THEN** 调用 `PUT /api/settings`，成功后提示"配置已保存，Pipeline 已重建"

#### Scenario: api_key 显示
- **WHEN** settings 页加载时 api_key 已设置
- **THEN** 前端显示 `****`，用户不填写时不覆盖现有值

