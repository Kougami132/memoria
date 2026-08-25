# 技术架构与设计方案：会话生成与主机审批状态断线持久化及恢复

## 1. 核心架构设计

### 1.1 现状与瓶颈
- 当前消息仅在整个 Agent 对话流程结束后才一次性写入 SQLite 数据库（`messages` 表）。
- 审批状态仅存在于内存单例 `HostApprovalManager` 中，未与数据库会话消息关联。
- 当用户刷新页面或退出时，前端 React 状态重置，重新请求历史消息列表无法还原正在等待审批的卡片。

### 1.2 目标架构
1. **即时持久化（Eager Persistence）**：
   - 当引擎触发 `host_command_approval` 时，立即在 `messages` 表中插入一条待审批消息记录（包含 `approval_id`、`host_name`、`command` 等）。
2. **状态感知与历史回显（Replay & Rebind）**：
   - 历史消息加载接口返回带有 `approval_id` 和待审批标记的消息。
   - 前端加载历史消息时，如检测到待审批状态，恢复渲染带有操作按钮的审批卡片。
3. **断线防误触（Unload Guard）**：
   - 前端在 `isLoading` 或有未处理审批时绑定 `beforeunload` 事件拦截误刷新。

---

## 2. 数据模型与接口设计

### 2.1 数据库字段扩展（`messages` 表）
- `status`: 消息状态，包括 `done`, `pending_approval`, `approved`, `rejected`
- `metadata`: JSON 字符串，存储 `{ approval_id, host_id, host_name, command }`

### 2.2 接口与流式事件交互
- `GET /api/sessions/{session_id}/messages` 和 `GET /api/agent-sessions/{session_id}/messages`：
  - 返回 message 对象中包含 `status` 与 `metadata`（已解析 JSON）。
- 审批响应 `POST /api/hosts/approvals/{approval_id}/respond`：
  - 更新内存中的审批状态并唤醒 Worker 事件循环；
  - 同步更新数据库中对应消息的状态为 `approved` 或 `rejected`。

---

## 3. 前端设计与状态管理
- `web/src/pages/AgenticChat.tsx` & `web/src/pages/Chat.tsx`：
  - `useEffect` 监听 `isStreaming` 与 `pendingApproval`，挂载 `window.onbeforeunload`；
  - 历史消息渲染组件支持根据 `msg.metadata?.approval_id` 渲染持久化的审批卡片，并对接审批响应接口。
