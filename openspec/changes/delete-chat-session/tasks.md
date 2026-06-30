## 1. 后端

- [x] 1.1 在 `memoria/storage/db.py` 中新增 `delete_session()` 方法，级联删除 messages
- [x] 1.2 在 `memoria/server/routes/sessions.py` 中新增 `DELETE /{session_id}` 端点，返回 204

## 2. 前端

- [x] 2.1 在 `web/src/api.ts` 中新增 `deleteSession()` 函数
- [x] 2.2 在 `web/src/pages/Chat.tsx` 中添加删除 mutation 和会话列表删除按钮（hover 显示）
- [x] 2.3 删除当前活跃会话时调用 `newSession()` 重置为空白状态
