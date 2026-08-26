# Technical Design: 历史消息编辑重发与重新生成架构设计

## 1. 架构目标与原则
- **分支与截断模型 (Truncation Model)**：当用户编辑历史消息或对某历史节点重新生成时，丢弃该节点（或该节点之后）的所有后续消息与思维链 Trace，保证会话时序和上下文纯净。
- **前后端一致性**：通过 API 显式同步截断数据库记录，避免前端截断而后端加载旧历史产生数据错乱。
- **Agent 与常规 Chat 统一**：统一普通 Bot 对话与 AgenticChat 的交互行为，针对 AgenticChat 深度清理 Traces 与未决审批状态。

---

## 2. 后端设计

### 2.1 存储层 (DB Layer)
在 `memoria/storage/db.py` 中增加消息截断方法：
```python
def truncate_messages_from(
    self,
    session_id: str,
    message_id: str,
    inclusive: bool = True
) -> int:
    pass
```
实现逻辑：
1. 查询目标 message 的 `created_at`。
2. 筛选在同一 `session_id` 下、时序大于目标消息（或大于等于，若 inclusive=True）的所有 `MessageRow.id`。
3. 删除 `MessageTraceRow` 中 `message_id` 在待删除列表中的所有记录。
4. 删除 `MessageRow` 中对应记录并提交事务。

### 2.2 接口层 (API Layer)
在 `memoria/server/routes/sessions.py` 和 `agent_sessions.py` 分别增加会话消息截断接口：
- `POST /api/sessions/{session_id}/truncate`
- `POST /api/agent-sessions/{session_id}/truncate`
请求体：
```json
{
  "message_id": "string",
  "inclusive": true
}
```
响应：
```json
{
  "session_id": "string",
  "deleted_count": 2
}
```

---

## 3. 前端设计

### 3.1 API 客户端 (`web/src/api.ts`)
新增方法：
- `truncateSessionMessages(sessionId: string, message_id: string, inclusive: boolean)`
- `truncateAgentSessionMessages(sessionId: string, message_id: string, inclusive: boolean)`

### 3.2 交互组件与状态设计 (`Chat.tsx` & `AgenticChat.tsx`)
1. **用户消息状态**：
   - `editingMessageId: string | null`：当前正在编辑的消息 ID。
   - `editingContent: string`：编辑框内暂存文本。
2. **操作触发流**：
   - **编辑并发送 (handleEditAndResend)**：
     - 若当前有正在生成的 stream，先取消/中断。
     - 调用 truncate API（`inclusive=true`，从该用户消息开始截断）。
     - 前端状态过滤掉该消息及后续所有消息。
     - 将新内容加入并调用现有 `runStream` 流程。
   - **直接重发 (handleResend)**：
     - 与编辑并发送类似，使用原消息内容作为新输入。
   - **重新生成助手回答 (handleRegenerate)**：
     - 找到该助手消息的前一条用户消息。
     - 调用 truncate API（`inclusive=true`，从该助手消息开始截断）。
     - 前端状态过滤掉该助手消息及后续消息。
     - 以该用户消息的内容重新触发 stream 生成。
3. **复制功能 (handleCopy)**：
   - 封装复制操作并展示 2 秒的 Check 图标反馈。
4. **视觉规范**：
   - 沿用 Tailwind 与现有简洁轻量风格，操作条采用透明背景、悬停显示、精致小图标与 Tooltip。

---

## 4. 兼容性与边界处理
- **单条消息会话**：第一条用户消息编辑或重新生成正常工作，不产生空指针异常。
- **并发与竞态**：生成中禁用操作条；若网络异常截断失败，前端弹出错误 Toast，不破坏当前界面。
