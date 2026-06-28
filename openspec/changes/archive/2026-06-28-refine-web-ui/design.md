## Context

Memoria Web UI 基于 React + TypeScript + TailwindCSS + shadcn/ui，当前使用框架的默认样式 token，未做任何视觉定制。整体呈现为"开箱即用的白色后台"风格，缺乏品牌识别度和视觉层次感。该 Web 应用的目标是面向个人和团队使用的 AI RAG 系统，需要具备 AI 产品的专业感。

## Goals / Non-Goals

**Goals:**
- 升级 Sidebar 为深色渐变设计，建立强品牌识别
- 主按钮和关键交互元素使用渐变色，提升视觉质量
- Chat 页面重设计为 AI 产品形态（头像、动画、悬浮输入框）
- 卡片、Empty State、Typography 全面精致化
- 全界面中文，消除所有英文文本残留

**Non-Goals:**
- 不新增功能或路由
- 不引入外部字体包
- 不实现深色模式切换
- 不改动任何后端/API 代码

## Decisions

### D1：Sidebar 深色渐变方案

**决策**：使用 `from-slate-900 via-purple-950 to-slate-900` 深色渐变作为 Sidebar 背景，文字和图标用白色/半透明白色。

**理由**：与内容区（白色/浅灰）形成强烈对比，建立明确的导航/内容视觉分区。这是 sub2api、Linear、Vercel Dashboard 等现代 SaaS 产品的通用做法。

**备选方案**：白色 Sidebar + 左侧彩色指示条 → 对比度不够，品牌感较弱，放弃。

---

### D2：渐变色 CSS 变量扩展策略

**决策**：在 `tailwind.config.js` 扩展 `colors.brand` token（`brand.from`/`brand.to`），在 `index.css` 新增 `--gradient-primary` 自定义属性，按钮和标题渐变统一引用该 token。

**理由**：避免在多个组件中硬编码相同渐变值，后续调色只需改一处。

---

### D3：Chat 重设计策略

**决策**：
- 助手消息左侧渲染 Brain 图标头像（`bg-gradient-to-br from-purple-500 to-blue-500` 圆形背景）
- 输入框改为底部全宽浮动区域（带 `backdrop-blur` 和 `border-t`），更接近 Claude Web
- 打字等待状态用三点跳动动画（CSS `@keyframes bounce`，stagger delay）
- 会话列表每项显示时间，active 状态同步使用渐变色

**理由**：以上是区分"聊天工具"和"AI 产品"最直观的视觉信号。

---

### D4：不引入额外组件库

**决策**：所有视觉升级在现有 shadcn/ui 组件基础上通过 className 覆盖实现，不新增 framer-motion 等动画库。

**理由**：减少 bundle size，保持构建简单。三点动画用纯 CSS 实现即可。

## Risks / Trade-offs

- **Sidebar 颜色与内容区分离**：深色 Sidebar 在不同显示器上的颜色可能有差异 → 使用 Tailwind 标准色值，有广泛测试基础，风险低
- **Chat 重设计范围较大**：Chat.tsx 是改动最多的文件，需注意不破坏现有数据流逻辑 → 仅改 JSX/className，不触碰 mutation 和 state 逻辑
- **全局 CSS 变量调整**：`index.css` 的 `--primary` 等变量变化可能影响未预期的组件 → 对每个 shadcn 组件做视觉回归检查
