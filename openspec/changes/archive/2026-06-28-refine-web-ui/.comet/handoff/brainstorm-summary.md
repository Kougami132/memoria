# Brainstorm Summary

- Change: refine-web-ui
- Date: 2026-06-28

## 确认的技术方案

**方案：className 覆盖 + variant 扩展 + 纯 CSS 动画（用户已确认）**

1. **基础层**：`index.css` 新增 `--gradient-sidebar` CSS 变量；`tailwind.config.js` 扩展 `colors.brand` token
2. **渐变按钮**：在 `web/src/components/ui/button.tsx` 新增 `variant: "gradient"`（CVA 扩展），全项目约 6 处主按钮改用 `variant="gradient"`
3. **Sidebar**：`bg-gradient-to-b from-slate-900 via-purple-950 to-slate-900`，文字白色系，active 用 `bg-white/15`
4. **Chat 重设计**：助手消息带 8x8 渐变圆形头像（Brain 图标），等待动画用三点纯 CSS bounce，输入区 backdrop-blur 悬浮感
5. **其余页面**：Empty State 图标渐变色 wrapper，卡片 hover 阴影上浮，主按钮统一 `variant="gradient"`

## 关键取舍与风险

- 不引入 framer-motion → bundle 零增长，动画纯 CSS 实现
- 不改 state/mutation 逻辑 → 降低功能回归风险
- 扩展 shadcn button.tsx variant → 可控，约定优于配置

## 测试策略

- `npm run build`（构建无报错）
- 浏览器逐页目测：Sidebar 渐变 / Chat 头像和动画 / 按钮渐变 / Empty State 彩色
- 确认无英文文字残留（扫描所有 .tsx placeholder 和 label）

## Spec Patch

无（纯视觉层改动，现有 spec 已覆盖所有 requirement）
