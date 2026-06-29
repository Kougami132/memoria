# Comet Design Handoff

- Change: chat-markdown-rendering
- Phase: design
- Mode: compact
- Context hash: ae81939d3edd8535c9d58d78a62c536a3fc2563477265be775cc740b6ae9f36f

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/chat-markdown-rendering/proposal.md

- Source: openspec/changes/chat-markdown-rendering/proposal.md
- Lines: 1-24
- SHA256: 88d66b90f252385206f34a31c0e6a497f29a35eed7c57111321817f68e72e2a3

```md
## Why

Web 端对话页中，assistant 消息以纯文本渲染，模型返回的 Markdown 格式（加粗、列表、代码块等）全部作为字面符号显示，影响可读性。

## What Changes

- 引入 `react-markdown` 依赖
- assistant 消息气泡改用 Markdown 渲染，user 消息保持纯文本

## Capabilities

### New Capabilities

- `chat-message-markdown`: assistant 消息气泡支持 Markdown 渲染（加粗、斜体、标题、列表、行内代码、代码块）

### Modified Capabilities

- `web-ui`: 对话页新增 assistant 消息 Markdown 渲染需求

## Impact

- `web/src/pages/Chat.tsx`：assistant 消息渲染逻辑改用 ReactMarkdown
- `web/package.json`：新增 `react-markdown` 依赖
- 不涉及后端 API、消息存储结构变更
```

## openspec/changes/chat-markdown-rendering/design.md

- Source: openspec/changes/chat-markdown-rendering/design.md
- Lines: 1-40
- SHA256: e1d567b7ef323d2f51250ae7da52309751054704708c7ba6c5e10634483a802f

```md
## Context

`Chat.tsx:175` 当前对 assistant 消息使用 `{m.content}` 直接渲染字符串，配合 `whitespace-pre-wrap` 样式，Markdown 符号以字面文本显示。项目使用 React 19 + Tailwind，无现有 Markdown 处理依赖。

## Goals / Non-Goals

**Goals:**
- assistant 消息气泡中的 Markdown 正确渲染（加粗、斜体、标题、列表、行内代码、代码块）
- user 消息保持现有纯文本渲染

**Non-Goals:**
- 语法高亮（rehype-highlight 等）
- @tailwindcss/typography 插件
- 后端 API 或消息存储结构变更
- user 消息 Markdown 渲染

## Decisions

### 选用 react-markdown

**决定**：使用 `react-markdown`，不使用 `marked + DOMPurify`。

**理由**：react-markdown 以 React 组件方式渲染，无需 `dangerouslySetInnerHTML`，天然避免 XSS 风险；TypeScript 类型完整；社区主流选择。marked 方案需额外引入 DOMPurify 消毒，维护成本更高。

### 仅渲染 assistant 消息

**决定**：`ReactMarkdown` 只包裹 assistant 气泡内容，user 气泡保持 `whitespace-pre-wrap` 纯文本。

**理由**：user 输入通常是自然语言，不预期 Markdown 格式；混入渲染反而会把用户随手打的 `*` 变成斜体，造成意外。

### 自定义 components 覆盖默认样式

**决定**：通过 `ReactMarkdown` 的 `components` prop 为 `code`、`pre`、`p`、`ul`、`ol` 等注入 Tailwind class，而非引入 typography 插件。

**理由**：保持与现有卡片 UI 风格一致，避免引入新的 CSS 层级和构建配置。

## Risks / Trade-offs

- [react-markdown 默认渲染 `<p>` 带 margin] → 用 `components` 覆盖 `p` 去掉 margin-top 以避免气泡内顶部空白
- [代码块无高亮] → 用 `bg-muted` 背景色区分，可读性可接受；语法高亮留作后续扩展点
```

## openspec/changes/chat-markdown-rendering/tasks.md

- Source: openspec/changes/chat-markdown-rendering/tasks.md
- Lines: 1-15
- SHA256: 8b244de4a828bb2961ff03aa2b377e1a136de4b6936a3136031958b1757541c0

```md
## 1. 依赖安装

- [ ] 1.1 在 web/ 目录安装 react-markdown 依赖

## 2. Chat.tsx 改造

- [ ] 2.1 引入 ReactMarkdown 组件
- [ ] 2.2 将 assistant 消息气泡内容替换为 ReactMarkdown 渲染，配置 components 覆盖默认样式（p、ul、ol、code、pre）
- [ ] 2.3 确认 user 消息气泡保持 whitespace-pre-wrap 纯文本渲染，不受影响

## 3. 验证

- [ ] 3.1 启动开发服务器，发送包含加粗、列表、代码块的 assistant 消息，确认正确渲染
- [ ] 3.2 确认 user 消息中的 Markdown 符号原样显示
- [ ] 3.3 确认现有卡片圆角、间距等样式无回归
```

## openspec/changes/chat-markdown-rendering/specs/chat-message-markdown/spec.md

- Source: openspec/changes/chat-markdown-rendering/specs/chat-message-markdown/spec.md
- Lines: 1-35
- SHA256: 27ecd1fe96a427353953fe7e4f97b2f121dc2eb5797f30cd8e2bd46a4147d04b

```md
## ADDED Requirements

### Requirement: assistant 消息 Markdown 渲染
Chat 页面的 assistant 消息气泡 SHALL 将消息内容解析为 Markdown 并渲染为格式化 HTML，而非纯文本字符串。

#### Scenario: 加粗和斜体
- **WHEN** assistant 消息内容包含 `**text**` 或 `_text_`
- **THEN** 气泡中显示加粗或斜体文本，而非字面符号

#### Scenario: 标题
- **WHEN** assistant 消息内容包含 `## 标题`
- **THEN** 气泡中显示对应级别的标题样式

#### Scenario: 无序列表
- **WHEN** assistant 消息内容包含 `- item` 列表
- **THEN** 气泡中显示带缩进的列表项

#### Scenario: 有序列表
- **WHEN** assistant 消息内容包含 `1. item` 有序列表
- **THEN** 气泡中显示带编号的列表项

#### Scenario: 行内代码
- **WHEN** assistant 消息内容包含 `` `code` ``
- **THEN** 气泡中显示等宽字体代码样式

#### Scenario: 代码块
- **WHEN** assistant 消息内容包含三反引号代码块
- **THEN** 气泡中显示独立代码块区域（背景色区分，无语法高亮）

### Requirement: user 消息不受影响
Chat 页面的 user 消息气泡 SHALL 继续以纯文本方式渲染，不解析 Markdown 符号。

#### Scenario: user 消息含 Markdown 符号
- **WHEN** user 消息内容包含 `**text**` 等 Markdown 符号
- **THEN** 气泡中原样显示字面文本，不做 Markdown 解析
```

## openspec/changes/chat-markdown-rendering/specs/web-ui/spec.md

- Source: openspec/changes/chat-markdown-rendering/specs/web-ui/spec.md
- Lines: 1-20
- SHA256: 1a271b664b8009a18a31f71c45b59fceb8d96aece070947ad834725372504832

```md
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
```

