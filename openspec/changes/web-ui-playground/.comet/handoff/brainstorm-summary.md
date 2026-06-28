# Brainstorm Summary

- Change: web-ui-playground
- Date: 2026-06-27

## 确认的技术方案

**后端：**
- Pipeline 重建：方案 B（`lru_cache(maxsize=1)` + `cache_clear()`），单进程够用，代码最简
- DB 层新增：`RuntimeSettingRow`（key/value/updated_at）、`list_sessions(bot_id)`、`get_messages_all(session_id)`（无 limit，供前端展示全量历史）
- `get_effective_settings(db)` 合并 `.env` 与 DB 覆盖值，DB 优先，空值回退
- `GET /api/settings` 返回明文 api_key（前端控制显示/隐藏）
- 新增 `GET /api/sessions/{session_id}/messages` 供切换会话时加载全量历史

**前端：**
- React 18 + TypeScript + Vite，输出到 `memoria/static/`，FastAPI StaticFiles 挂载
- shadcn/ui + Tailwind CSS，React Query 管理服务端状态
- Settings 页 api_key：默认显示 `****`，旁边眼睛 icon 点击切换明文/掩码，方式 B（直接点清空输入，空提交不覆盖）
- 对话页：左侧会话列表（含"新建会话"按钮）+ 右侧消息区，切换会话时加载全量历史并可继续发消息

## 关键取舍与风险

- `get_messages_all` 无 limit，历史很长时前端渲染压力；当前 Phase 接受
- `lru_cache` 非严格线程安全，单 worker 无问题，多 worker 部署需重新评估
- `GET /api/settings` 返回明文 api_key，仅适用本地单用户场景
- 静态文件缺失时跳过挂载并 log warning，不影响 API 正常运行

## 测试策略

- 后端：pytest 覆盖 DB 新方法、settings 路由（覆盖值生效/回退/api_key 空值跳过）、pipeline 重建、chat sources 字段、sessions 路由
- 前端：手动集成验收（Vite dev server proxy 指向 :8000 开发，build 后集成测试）

## Spec Patch

`chat-session` delta spec 新增 scenario：
- WHEN `GET /api/sessions/{session_id}/messages`
- THEN 返回该 session 的全量消息列表，按时间升序，每项含 `role`、`content`、`created_at`
