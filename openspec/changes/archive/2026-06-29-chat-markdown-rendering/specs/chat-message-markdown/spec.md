## ADDED Requirements

### Requirement: assistant 消息 Markdown 渲染
Chat 页面的 assistant 消息气泡 SHALL 将消息内容解析为 Markdown 并渲染为格式化 HTML，而非纯文本字符串。

#### Scenario: 加粗和斜体
- **WHEN** assistant 消息内容包含 `**text**` 或 `_text_`
- **THEN** 气泡中显示加粗或斜体文本，而非字面符号

#### Scenario: 标题
- **WHEN** assistant 消息内容包含 `## 标题`
- **THEN** 气泡中显示对应级别的标题样式

#### Scenario: 无序列表
- **WHEN** assistant 消息内容包含 `- item` 列表
- **THEN** 气泡中显示带缩进的列表项

#### Scenario: 有序列表
- **WHEN** assistant 消息内容包含 `1. item` 有序列表
- **THEN** 气泡中显示带编号的列表项

#### Scenario: 行内代码
- **WHEN** assistant 消息内容包含 `` `code` ``
- **THEN** 气泡中显示等宽字体代码样式

#### Scenario: 代码块
- **WHEN** assistant 消息内容包含三反引号代码块
- **THEN** 气泡中显示独立代码块区域（背景色区分，无语法高亮）

### Requirement: user 消息不受影响
Chat 页面的 user 消息气泡 SHALL 继续以纯文本方式渲染，不解析 Markdown 符号。

#### Scenario: user 消息含 Markdown 符号
- **WHEN** user 消息内容包含 `**text**` 等 Markdown 符号
- **THEN** 气泡中原样显示字面文本，不做 Markdown 解析
