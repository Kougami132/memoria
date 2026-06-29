## MODIFIED Requirements

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
