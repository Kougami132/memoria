# Implementation Plan: 历史消息编辑重发与重新生成

## Checklist

- [ ] **Step 1: 后端存储与截断能力实现**
  - [ ] 在 `memoria/storage/db.py` 中添加 `truncate_messages_from(session_id, message_id, inclusive)` 方法
  - [ ] 确保级联删除关联的 `MessageTraceRow`
  - [ ] 编写并运行单元测试 `tests/test_db_truncate.py` 验证截断与 Trace 清理行为

- [ ] **Step 2: 后端路由接口**
  - [ ] 在 `memoria/server/routes/sessions.py` 增加 `POST /api/sessions/{session_id}/truncate`
  - [ ] 在 `memoria/server/routes/agent_sessions.py` 增加 `POST /api/agent-sessions/{session_id}/truncate`
  - [ ] 编写路由测试验证接口状态码与权限/存在性校验

- [ ] **Step 3: 前端 API 客户端适配**
  - [ ] 在 `web/src/api.ts` 添加 `truncateSessionMessages` 和 `truncateAgentSessionMessages`

- [ ] **Step 4: 前端 Chat.tsx 交互实现**
  - [ ] 在用户消息气泡添加 Hover 操作条（编辑、重发、复制）
  - [ ] 实现用户消息内嵌编辑模式（文本域、保存发送、取消、快捷键）
  - [ ] 在助手消息底部添加操作条（重新生成、复制）
  - [ ] 接入 `handleEditAndResend`、`handleResend`、`handleRegenerate` 并与后端 truncate API 对接

- [ ] **Step 5: 前端 AgenticChat.tsx 交互实现**
  - [ ] 在 AgenticChat 的用户与助手消息上复用相同的操作模式与视觉样式
  - [ ] 重新生成时正确重置 Agentic 思维链、耗时、Token 统计与流式状态

- [ ] **Step 6: 构建与端到端验证**
  - [ ] 运行 `pytest` 确保所有后端测试通过
  - [ ] 运行 `npm run build`（在 `web/` 目录）确保前端 TypeScript 编译与打包无错误
  - [ ] 运行静态代码扫描并同步更新 Trellis spec / journal
