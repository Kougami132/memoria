# 实施计划：会话生成与主机审批状态断线持久化及恢复

## 1. 任务目标
实现流式生成与主机命令审批在浏览器断线/刷新时的防误触拦截、即时中间态持久化与页面重新加载后的状态自动恢复。

---

## 2. 实施步骤清单

### Step 1: 数据库存储层扩展
- [ ] 修改 `memoria/storage/db.py` 中的 `MessageRow` 数据表定义，增加 `status` 和 `metadata` 字段（以及自动表迁移支持）。
- [ ] 修改 `add_message` 与 `get_messages` 方法，支持存储与返回消息 `status` 和 `metadata`。
- [ ] 增加 `update_message_status` 方法，支持审批完成后更新已持久化消息的状态。

### Step 2: 服务端审批即时落库与响应同步
- [ ] 在 `memoria/agents/engine.py` 流式处理中，触发 `host_command_approval` 时即时调用 `db.add_message` 记录待审批状态。
- [ ] 在 `memoria/server/routes/hosts.py` 的审批响应端点中，响应审批决策后同步更新对应数据库消息状态。

### Step 3: 前端断线防误触拦截与历史回显
- [ ] 在 `web/src/pages/Chat.tsx` 与 `web/src/pages/AgenticChat.tsx` 中增加 `beforeunload` 页面卸载拦截。
- [ ] 在历史消息列表渲染中增加对 `status === 'pending_approval'` 消息的判断与审批卡片还原。

### Step 4: 测试验证与构建
- [ ] 编写并运行单元测试 `tests/test_session_persistence.py`。
- [ ] 运行前端构建 `npm run build`，确保无类型和打包错误。

---

## 3. 验证与回归命令
```bash
pytest tests/ -v
cd web && npm run build
```
