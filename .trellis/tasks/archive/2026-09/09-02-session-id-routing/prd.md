# 会话路由与新会话入口

## Goal

侧边栏“常规对话”和“AI Agent”入口每次打开空白新会话；已有会话使用包含 session ID 的 URL，刷新后恢复当前会话。

## Requirements

- `/chat` 和 `/agentic-chat` 表示尚未创建的空白新会话。
- `/chat/:sessionId` 和 `/agentic-chat/:sessionId` 表示指定的已有会话。
- URL 是当前会话的唯一来源，不再从 localStorage 隐式恢复上一次会话。
- 普通会话刷新时必须恢复该会话所属的 bot。
- 新会话首次发送并取得后端 session ID 后，立即替换为带 ID 的 URL。

## Acceptance Criteria

- [x] 点击两个主侧边栏入口时始终显示空白新会话。
- [x] 点击历史会话后，URL 包含对应 session ID。
- [x] 刷新带 ID 的 URL 后，恢复对应会话及其消息。
- [x] 普通会话刷新后选择正确的 bot。
- [x] 新会话首次发送取得 ID 后，URL 立即更新且不额外留下临时历史记录。
- [x] 删除当前会话后，URL 与后续选中会话一致；无剩余会话时回到基础路径。
- [x] 切换普通对话 bot 后进入该 bot 的空白新会话。

## Notes

- 保持现有延迟创建会话行为：用户首次发送消息时才由后端创建会话。
