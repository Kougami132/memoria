## 1. 依赖安装

- [x] 1.1 在 web/ 目录安装 react-markdown 依赖

## 2. Chat.tsx 改造

- [x] 2.1 引入 ReactMarkdown 组件
- [x] 2.2 将 assistant 消息气泡内容替换为 ReactMarkdown 渲染，配置 components 覆盖默认样式（p、ul、ol、code、pre）
- [x] 2.3 确认 user 消息气泡保持 whitespace-pre-wrap 纯文本渲染，不受影响

## 3. 验证

- [x] 3.1 启动开发服务器，发送包含加粗、列表、代码块的 assistant 消息，确认正确渲染
- [x] 3.2 确认 user 消息中的 Markdown 符号原样显示
- [x] 3.3 确认现有卡片圆角、间距等样式无回归
