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
