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
