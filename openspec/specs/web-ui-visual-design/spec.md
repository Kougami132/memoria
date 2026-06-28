# web-ui-visual-design Specification

## Purpose
TBD - created by archiving change refine-web-ui. Update Purpose after archive.
## Requirements
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

