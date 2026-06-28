## Why

现有 Web UI 使用 shadcn/ui 默认样式，视觉层次薄弱、品牌感缺失，不符合现代 AI 产品的设计标准，无法作为面向他人展示的产品界面。参考 sub2api 的管理台风格，将 UI 升级为精致、专业的 AI 产品形态。

## What Changes

- **Sidebar**：深色渐变背景（深紫→深蓝），品牌 Logo 区视觉加强，导航项 active 状态用亮色指示块，底部版权区精致化
- **主按钮**：渐变色（紫→蓝），hover 有反馈动画
- **页面标题**：h1 使用主色渐变文字，字重和间距优化
- **卡片**：hover 时阴影上浮，内部分区更清晰
- **Empty State**：彩色图标+引导文案，替换原有灰色占位
- **Chat 页面**：重设计为 AI 产品形态——助手消息带 Brain 头像、三点打字动画、底部悬浮输入框、会话列表预览首条消息
- **全局 CSS 变量**：调整颜色 token，丰富主色和渐变层次
- 全界面中文，消除所有英文残留（title、placeholder、hint 文本）

## Capabilities

### New Capabilities
- 无新功能能力

### Modified Capabilities
- 无 spec 级行为变更（纯视觉层改动）

## Impact

- `web/src/index.css`：CSS 变量和基础样式
- `web/src/components/Layout.tsx`：Sidebar 重设计
- `web/src/pages/KnowledgeBases.tsx`：卡片和 empty state
- `web/src/pages/Bots.tsx`：卡片和 empty state
- `web/src/pages/Chat.tsx`：AI 产品形态重设计
- `web/src/pages/Settings.tsx`：分组卡片视觉优化
- `web/tailwind.config.js`：可能扩展颜色 token
- 不涉及 API、数据库、后端任何代码
