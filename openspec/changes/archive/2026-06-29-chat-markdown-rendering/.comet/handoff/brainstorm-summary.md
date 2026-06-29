# Brainstorm Summary

- Change: chat-markdown-rendering
- Date: 2026-06-28

## 确认的技术方案

引入 react-markdown v9（ESM-only，兼容项目 Vite + type:module），仅修改 Chat.tsx 中 assistant 消息气泡渲染逻辑。用 ReactMarkdown 组件替换直接渲染的 `{m.content}`，通过 `components` prop 为 p、ul、ol、code、pre、h1-h3、a、strong 注入 Tailwind class，覆盖默认样式以贴合现有卡片 UI。user 消息保持 whitespace-pre-wrap 纯文本渲染。

## 关键取舍与风险

- react-markdown 将连续换行解析为 `<p>` 而非 `<br>`，视觉效果与 whitespace-pre-wrap 接近，可接受
- 无语法高亮，代码块仅用 bg-muted 背景色区分，留作后续扩展点
- 移除 assistant 气泡的 whitespace-pre-wrap，由 ReactMarkdown 自行处理换行

## 测试策略

- 启动 dev server，发送包含 Markdown 格式的 assistant 消息（加粗、列表、代码块），目视确认渲染正确
- 确认 user 消息 Markdown 符号原样显示
- 确认卡片圆角、间距等现有样式无回归

## Spec Patch

无
