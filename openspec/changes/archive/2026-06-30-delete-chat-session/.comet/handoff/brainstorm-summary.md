# Brainstorm Summary

- Change: delete-chat-session
- Date: 2025-08-01

## 确认的技术方案

后端：`DB.delete_session()` 应用层级联删除 messages → sessions，与 `delete_bot` 模式一致。`DELETE /sessions/{session_id}` 返回 204，不存在时返回 404。

前端：`api.ts` 新增 `deleteSession()`。`Chat.tsx` 每条会话 hover 显示 Trash2 删除按钮，useMutation 成功后 `refetchSessions()`，若删除当前活跃会话则调用已有的 `newSession()` 重置为空白状态。

## 关键取舍与风险

- 无确认弹窗（用户明确要求直接进入新建对话状态）
- hover-only 按钮防误触
- 无 undo，删除永久生效

## 测试策略

手动验证 3 个 spec 场景：删除非活跃会话、删除活跃会话（自动重置）、DELETE 不存在 session_id 返回 404。

## Spec Patch

无
