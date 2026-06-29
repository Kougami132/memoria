---
comet_change: chat-markdown-rendering
role: technical-design
canonical_spec: openspec
---

# Chat Markdown Rendering — Design Doc

## 问题

`Chat.tsx:175` assistant 消息气泡使用 `{m.content}` 直接渲染字符串，`whitespace-pre-wrap` 仅保留换行，模型返回的 Markdown 符号（`**加粗**`、`## 标题`、代码块等）全部作为字面文本显示。

## 方案

引入 `react-markdown` v9，仅替换 assistant 消息气泡的渲染逻辑。user 消息气泡不变。

### 依赖

```
react-markdown   v9（ESM-only，兼容 Vite + "type":"module"）
```

无需额外插件（rehype-highlight、remark-gfm 等）。

### Chat.tsx 改动

assistant 气泡（`Chat.tsx:175`）从：

```tsx
<div className="rounded-2xl rounded-tl-sm bg-card border px-4 py-3 text-sm leading-relaxed shadow-sm whitespace-pre-wrap">
  {m.content}
</div>
```

改为：

```tsx
<div className="rounded-2xl rounded-tl-sm bg-card border px-4 py-3 text-sm leading-relaxed shadow-sm">
  <ReactMarkdown components={mdComponents}>{m.content}</ReactMarkdown>
</div>
```

移除 `whitespace-pre-wrap`（ReactMarkdown 自行处理换行）。

### components 映射

```tsx
const mdComponents = {
  p:      ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul:     ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-0.5">{children}</ul>,
  ol:     ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-0.5">{children}</ol>,
  code:   ({ inline, children }) =>
    inline
      ? <code className="bg-muted rounded px-1 font-mono text-xs">{children}</code>
      : <code>{children}</code>,
  pre:    ({ children }) => <pre className="bg-muted rounded-xl p-3 overflow-x-auto mb-2 text-xs font-mono">{children}</pre>,
  h1:     ({ children }) => <h1 className="font-semibold text-base mt-3 mb-1">{children}</h1>,
  h2:     ({ children }) => <h2 className="font-semibold text-sm mt-3 mb-1">{children}</h2>,
  h3:     ({ children }) => <h3 className="font-semibold text-sm mt-2 mb-1">{children}</h3>,
  a:      ({ href, children }) => <a href={href} className="text-primary underline" target="_blank" rel="noreferrer">{children}</a>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
}
```

`mdComponents` 定义在组件外（模块级常量），避免每次渲染重新创建对象。

## 风险与取舍

| 风险 | 缓解 |
|------|------|
| 连续换行解析为 `<p>` 而非 `<br>` | `p` 设 `mb-2`，视觉效果与原 `whitespace-pre-wrap` 接近 |
| 代码块无语法高亮 | `bg-muted` 背景色区分，留作后续扩展点 |

## 非目标

- 语法高亮
- `@tailwindcss/typography` 插件
- user 消息 Markdown 渲染
- 后端 API / 消息存储变更
