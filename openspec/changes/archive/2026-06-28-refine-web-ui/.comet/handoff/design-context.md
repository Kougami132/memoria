# Comet Design Handoff

- Change: refine-web-ui
- Phase: design
- Mode: compact
- Context hash: 7357ec94745b4a5fe8e67eb36cfd0d4b8761e0b8184753e24d5491e93c16babf

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/refine-web-ui/proposal.md

- Source: openspec/changes/refine-web-ui/proposal.md
- Lines: 1-33
- SHA256: 869270d7db5da39fd3807f7cb00b0c3b6c4180024320572a73787469193fdf92

```md
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
```

## openspec/changes/refine-web-ui/design.md

- Source: openspec/changes/refine-web-ui/design.md
- Lines: 1-62
- SHA256: 3deb3a7ffb7eb68a94b63f9e177c3b04e360e88dacbbcfccf6882cd99495cb8a

```md
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
```

## openspec/changes/refine-web-ui/tasks.md

- Source: openspec/changes/refine-web-ui/tasks.md
- Lines: 1-44
- SHA256: d18a35c06e2abf13422e8b587baac2f0aa03ece1ef136ba6a0786b612e696d69

```md
## 1. 基础样式与配置

- [ ] 1.1 更新 `web/src/index.css`：调整 CSS 变量颜色 token，新增 `--gradient-primary`、`--gradient-sidebar` 等渐变变量
- [ ] 1.2 更新 `web/tailwind.config.js`：扩展 `colors.brand` 渐变 token，确保渐变类名可用
- [ ] 1.3 更新 `web/index.html`：将 `<title>` 改为"Memoria"

## 2. Sidebar 重设计

- [ ] 2.1 更新 `web/src/components/Layout.tsx`：Sidebar 背景改为深色渐变（深紫→深蓝），文字和图标改为白色系
- [ ] 2.2 Logo 区：增加轻微光晕或品牌感圆形图标背景，字体加粗
- [ ] 2.3 导航项 active 状态：使用亮色半透明背景块（而非纯色填充），hover 状态有过渡动画
- [ ] 2.4 底部区域：版权文字精致化，使用半透明白色

## 3. Chat 页面重设计

- [ ] 3.1 助手消息：左侧添加 Brain 图标头像（渐变背景圆形，尺寸 8x8）
- [ ] 3.2 等待动画：将"正在思考…"文字替换为三点跳动 CSS 动画（在 index.css 中定义 `@keyframes bounce-dot`）
- [ ] 3.3 输入框区域：增加 `backdrop-blur`，padding 加大，输入框圆角加大，发送按钮使用渐变色
- [ ] 3.4 会话列表项：显示创建时间，active 状态使用渐变背景，非 active hover 有平滑过渡
- [ ] 3.5 空状态：选择机器人前的空状态使用彩色图标+引导文案

## 4. 知识库页面精致化

- [ ] 4.1 Empty State：Database 图标使用主色渐变色，引导文案优化
- [ ] 4.2 知识库卡片：hover 时增加阴影上浮效果，header 分区样式加强
- [ ] 4.3 主按钮"新建知识库"：应用渐变色样式
- [ ] 4.4 文档列表项：hover 背景更明显，文件图标使用主色

## 5. 机器人页面精致化

- [ ] 5.1 Empty State：Bot 图标使用主色渐变色，引导文案优化
- [ ] 5.2 机器人卡片：hover 阴影上浮，Bot 图标加强视觉
- [ ] 5.3 主按钮"新建机器人"：应用渐变色样式
- [ ] 5.4 知识库关联 checkbox 区域：选中状态更明显

## 6. 设置页面优化

- [ ] 6.1 Card 标题：`CardTitle` 字重和颜色加强
- [ ] 6.2 保存按钮：应用渐变色样式，已保存状态使用绿色渐变
- [ ] 6.3 确认所有 placeholder/label 文字为中文

## 7. 全局中文检查

- [ ] 7.1 扫描所有 `.tsx` 文件，确认无英文 UI 文字残留（placeholder、button label、hint text 等）
```

## openspec/changes/refine-web-ui/specs/web-ui-visual-design/spec.md

- Source: openspec/changes/refine-web-ui/specs/web-ui-visual-design/spec.md
- Lines: 1-40
- SHA256: 8f6b2e067a15f34ff14d6da5e67c9f077baf29ca9a1cf69f582fd1b2094074eb

```md
## ADDED Requirements

### Requirement: Sidebar 使用深色渐变品牌样式
Sidebar 背景 SHALL 使用深色渐变（深紫→深蓝），导航文字和图标使用白色/半透明白色，active 导航项使用亮色高亮块。

#### Scenario: 访问任意页面时 Sidebar 可见
- **WHEN** 用户打开 Web 应用
- **THEN** 左侧 Sidebar 显示深色渐变背景，Memoria 品牌文字清晰可见，当前页面导航项高亮

### Requirement: 主按钮使用渐变色样式
主操作按钮（primary Button）SHALL 使用紫→蓝渐变背景色，hover 时有视觉反馈。

#### Scenario: 点击新建按钮
- **WHEN** 用户将鼠标悬停在主按钮上
- **THEN** 按钮呈现明显的 hover 状态变化（亮度或阴影）

### Requirement: Chat 页面呈现 AI 产品形态
Chat 页面 SHALL 具备：助手消息带品牌头像图标、等待回复时显示三点跳动动画、输入框区域视觉突出。

#### Scenario: 助手回复消息展示
- **WHEN** 助手返回消息
- **THEN** 消息左侧显示 Brain 图标头像（渐变背景圆形），消息气泡有适当的圆角和阴影

#### Scenario: 等待助手回复
- **WHEN** 用户发送消息后等待回复
- **THEN** 显示三点跳动动画替代"正在思考…"文字

### Requirement: Empty State 使用彩色视觉设计
各页面的空状态 SHALL 使用彩色图标（而非灰色）和引导性操作文案。

#### Scenario: 知识库页面无数据
- **WHEN** 用户首次访问知识库页面且无任何知识库
- **THEN** 显示彩色 Database 图标和中文引导文案，提示创建第一个知识库

### Requirement: 全界面使用中文
界面所有文本 SHALL 使用中文，包括标题、placeholder、提示文字、按钮文字。

#### Scenario: 设置页面占位文字
- **WHEN** 用户查看设置页面的输入框
- **THEN** 所有 placeholder 文字为中文，无英文残留
```

