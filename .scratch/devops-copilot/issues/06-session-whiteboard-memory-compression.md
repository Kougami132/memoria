# 06: 长会话状态事实白板摘要压缩 (Session Whiteboard Memory Consolidation)

**What to build:** 
设计并实现长排障会话分层上下文管理。当单次会话的历史累积 Token 超过警戒水位线（默认 8,000 tokens）时，后台自动提取窗口外的早期交互，压缩为结构化“会话状态事实白板”（包括：已确认事实、已排查步骤、关键安全约束），将“系统提示词 + 事实白板 + 最近 4~6 轮原始对话”重新组装输入模型，防止上下文撑爆与安全规则遗忘。

**Blocked by:** None (can start immediately)

**Status:** closed

- [x] 实现会话 Token 动态估算器与水位线检测逻辑
- [x] 实现后台事实白板提炼逻辑（Prompt-driven memory consolidation）
- [x] 改造 `AgentEngine` / `TurnOrchestrator` 上下文组装管道（注入白板 + 滑动窗口最近消息）
- [x] 在 `Orchestrator Turn Seam` 编写并通过测试（模拟 20+ 轮深度排障，验证白板正确浓缩事实且初始约束在长轮次中依然有效）
