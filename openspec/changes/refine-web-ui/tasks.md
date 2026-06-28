## 1. 基础样式与配置

- [x] 1.1 更新 `web/src/index.css`：调整 CSS 变量颜色 token，新增 `--gradient-primary`、`--gradient-sidebar` 等渐变变量
- [x] 1.2 更新 `web/tailwind.config.js`：扩展 `colors.brand` 渐变 token，确保渐变类名可用
- [x] 1.3 更新 `web/index.html`：将 `<title>` 改为"Memoria"

## 2. Sidebar 重设计

- [x] 2.1 更新 `web/src/components/Layout.tsx`：Sidebar 背景改为深色渐变（深紫→深蓝），文字和图标改为白色系
- [x] 2.2 Logo 区：增加轻微光晕或品牌感圆形图标背景，字体加粗
- [x] 2.3 导航项 active 状态：使用亮色半透明背景块（而非纯色填充），hover 状态有过渡动画
- [x] 2.4 底部区域：版权文字精致化，使用半透明白色

## 3. Chat 页面重设计

- [x] 3.1 助手消息：左侧添加 Brain 图标头像（渐变背景圆形，尺寸 8x8）
- [x] 3.2 等待动画：将"正在思考…"文字替换为三点跳动 CSS 动画（在 index.css 中定义 `@keyframes bounce-dot`）
- [x] 3.3 输入框区域：增加 `backdrop-blur`，padding 加大，输入框圆角加大，发送按钮使用渐变色
- [x] 3.4 会话列表项：显示创建时间，active 状态使用渐变背景，非 active hover 有平滑过渡
- [x] 3.5 空状态：选择机器人前的空状态使用彩色图标+引导文案

## 4. 知识库页面精致化

- [x] 4.1 Empty State：Database 图标使用主色渐变色，引导文案优化
- [x] 4.2 知识库卡片：hover 时增加阴影上浮效果，header 分区样式加强
- [x] 4.3 主按钮"新建知识库"：应用渐变色样式
- [x] 4.4 文档列表项：hover 背景更明显，文件图标使用主色

## 5. 机器人页面精致化

- [x] 5.1 Empty State：Bot 图标使用主色渐变色，引导文案优化
- [x] 5.2 机器人卡片：hover 阴影上浮，Bot 图标加强视觉
- [x] 5.3 主按钮"新建机器人"：应用渐变色样式
- [x] 5.4 知识库关联 checkbox 区域：选中状态更明显

## 6. 设置页面优化

- [x] 6.1 Card 标题：`CardTitle` 字重和颜色加强
- [x] 6.2 保存按钮：应用渐变色样式，已保存状态使用绿色渐变
- [x] 6.3 确认所有 placeholder/label 文字为中文

## 7. 全局中文检查

- [x] 7.1 扫描所有 `.tsx` 文件，确认无英文 UI 文字残留（placeholder、button label、hint text 等）
