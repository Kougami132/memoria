---
comet_change: refine-web-ui
role: technical-design
canonical_spec: openspec
---

# Memoria Web UI 精致化 — Technical Design

## 1. 背景与范围

Memoria Web UI（React + TypeScript + TailwindCSS + shadcn/ui）当前使用框架默认样式，缺乏品牌识别度和 AI 产品的专业感。本次变更在不引入新功能、不改动 API/后端的前提下，对全部 Web 页面做视觉层精致化，参考 sub2api 管理台风格，Chat 页面对标 AI 产品形态。

**受影响文件：**

| 文件 | 改动类型 |
|------|---------|
| `web/src/index.css` | 新增 CSS 变量、keyframe 动画 |
| `web/tailwind.config.js` | 扩展 brand color token |
| `web/index.html` | title 改为 Memoria |
| `web/src/components/ui/button.tsx` | 新增 gradient variant |
| `web/src/components/Layout.tsx` | Sidebar 完全重写 |
| `web/src/pages/Chat.tsx` | JSX 层结构重构 |
| `web/src/pages/KnowledgeBases.tsx` | Empty state + 卡片样式 |
| `web/src/pages/Bots.tsx` | Empty state + 卡片样式 |
| `web/src/pages/Settings.tsx` | 卡片标题 + 按钮样式 |

## 2. 基础样式层

### 2.1 CSS 变量（index.css）

```css
/* 新增渐变变量 */
--gradient-sidebar: linear-gradient(to bottom, #0f172a, #3b0764, #0f172a);
--gradient-primary: linear-gradient(to right, #9333ea, #3b82f6);
```

保留现有 `--primary`、`--background` 等 oklch 变量不变，只做叠加。

### 2.2 Tailwind Brand Token（tailwind.config.js）

```js
extend: {
  colors: {
    brand: {
      from: '#9333ea',  // purple-600
      to:   '#3b82f6',  // blue-500
    }
  }
}
```

### 2.3 三点跳动动画（index.css）

```css
@keyframes bounce-dot {
  0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
  40%           { transform: translateY(-6px); opacity: 1; }
}
.dot-1 { animation: bounce-dot 1.2s infinite 0ms; }
.dot-2 { animation: bounce-dot 1.2s infinite 150ms; }
.dot-3 { animation: bounce-dot 1.2s infinite 300ms; }
```

## 3. 渐变按钮（button.tsx）

在 `cva` 的 `variants.variant` 中新增一项：

```ts
gradient: 'bg-gradient-to-r from-purple-600 to-blue-500 text-white shadow-sm hover:brightness-110 hover:shadow-md transition-all',
```

用法：`<Button variant="gradient">新建知识库</Button>`

全项目约 6 处主 CTA 按钮切换到此 variant，其余按钮（ghost、outline）保持不变。

## 4. Sidebar 重设计（Layout.tsx）

```
┌──────────────────────────────┐
│  深色渐变背景                │  bg-gradient-to-b from-slate-900
│  ┌──────────────────────┐   │   via-purple-950 to-slate-900
│  │ ◎ Memoria  [光晕]    │   │  w-60
│  └──────────────────────┘   │
│                              │
│  ▐ 知识库  （active）        │  bg-white/15 text-white rounded-lg
│    机器人                    │  text-white/60 hover:text-white
│    对话                      │  hover:bg-white/10 transition-colors
│    设置                      │
│                              │
│  RAG 记忆系统  v0.1          │  text-white/30 text-xs
└──────────────────────────────┘
```

- Logo 区：Brain 图标加渐变背景圆形（`bg-gradient-to-br from-purple-500 to-blue-500 rounded-xl p-1.5`）
- 侧边栏宽度从 `w-56` 改为 `w-60`，视觉更舒展

## 5. Chat 页面重设计（Chat.tsx）

### 5.1 助手消息结构

```tsx
{/* 助手消息 */}
<div className="flex items-start gap-3">
  {/* 头像 */}
  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-blue-500
                  flex items-center justify-center shrink-0 shadow-sm">
    <Brain className="h-4 w-4 text-white" />
  </div>
  {/* 气泡 */}
  <div className="rounded-2xl rounded-tl-sm bg-white border px-4 py-3
                  text-sm leading-relaxed shadow-sm max-w-[75%]">
    {content}
  </div>
</div>
```

### 5.2 等待动画

```tsx
{/* 替代原"正在思考…"文字 */}
<div className="flex items-start gap-3">
  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-blue-500
                  flex items-center justify-center shrink-0">
    <Brain className="h-4 w-4 text-white" />
  </div>
  <div className="bg-white border rounded-2xl rounded-tl-sm px-4 py-3.5 shadow-sm">
    <div className="flex gap-1.5 items-center h-5">
      <span className="w-1.5 h-1.5 rounded-full bg-purple-400 dot-1" />
      <span className="w-1.5 h-1.5 rounded-full bg-purple-400 dot-2" />
      <span className="w-1.5 h-1.5 rounded-full bg-purple-400 dot-3" />
    </div>
  </div>
</div>
```

### 5.3 输入区

```tsx
<div className="border-t bg-background/80 backdrop-blur-sm px-4 py-4 shrink-0">
  <div className="flex gap-2 max-w-3xl mx-auto">
    <Input className="rounded-2xl text-sm" placeholder="输入消息，按 Enter 发送…" />
    <Button variant="gradient" className="rounded-2xl px-4 shrink-0">
      <Send className="h-4 w-4" />
    </Button>
  </div>
</div>
```

### 5.4 会话列表

```tsx
<button className={`w-full text-left rounded-xl px-3 py-3 text-xs transition-colors ${
  active
    ? 'bg-gradient-to-r from-purple-600/90 to-blue-500/90 text-white shadow-sm'
    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
}`}>
  <p className="font-medium truncate">会话 {index + 1}</p>
  <p className="opacity-60 mt-0.5">{formatDate(created_at)}</p>
</button>
```

## 6. 卡片 & Empty State 规范

### 卡片 hover 效果（统一规范）

```tsx
<Card className="overflow-hidden transition-all hover:shadow-md hover:-translate-y-0.5">
```

### Empty State 图标容器（统一规范）

```tsx
<div className="bg-gradient-to-br from-purple-500/10 to-blue-500/10
                rounded-2xl p-5 mb-4 inline-block">
  <Database className="h-10 w-10 text-purple-500" />
</div>
```

引导文案：中文主标题（`font-medium`）+ 副标题（`text-sm text-muted-foreground`）

## 7. 风险与边界

| 风险 | 缓解措施 |
|------|---------|
| `backdrop-blur` 在 Firefox 可能需要 `-webkit-backdrop-filter` | 仅影响输入区，不影响核心功能 |
| Chat.tsx 重构量最大，易引入渲染 bug | 只改 JSX/className，不触碰 state/mutation；逐条测试 |
| button.tsx variant 扩展影响所有使用默认 variant 的按钮 | 新增 variant 不修改现有 variant，零影响 |

## 8. 验收标准

1. `npm run build` 构建无报错、无 TypeScript 类型错误
2. Sidebar 显示深色渐变背景，当前页面导航项亮色高亮
3. 所有主 CTA 按钮呈现紫→蓝渐变
4. Chat 页面：助手消息有渐变圆形头像，等待时三点跳动，输入框有 backdrop-blur 效果
5. 知识库/机器人页面空状态：彩色图标+中文引导
6. 全界面无英文 UI 文字残留
