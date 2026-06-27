## 1. 后端：DB 层扩展

- [ ] 1.1 新增 `runtime_settings` 表（key-value），迁移脚本或 `Base.metadata.create_all`
- [ ] 1.2 实现 `db.get_setting(key)` / `db.set_setting(key, value)` / `db.get_all_settings()`
- [ ] 1.3 实现 `db.list_sessions(bot_id)` 按 created_at 倒序返回会话列表
- [ ] 1.4 实现 `db.get_messages_all(session_id)` 返回全量消息（无 limit，按 created_at 升序）

## 2. 后端：配置覆盖层

- [ ] 2.1 修改 `config.py`，新增 `get_effective_settings()` 合并 DB 覆盖值与 Settings 默认值
- [ ] 2.2 修改 `deps.py`，将 `get_pipeline` 从 `@lru_cache` 改为可重置的模块级变量，暴露 `reset_pipeline()`

## 3. 后端：新增 / 修改路由

- [ ] 3.1 新增 `memoria/server/routes/settings.py`：`GET /api/settings`（api_key 掩码）、`PUT /api/settings`（空值跳过写入，保存后调 `reset_pipeline()`）
- [ ] 3.2 修改 `memoria/server/routes/bots.py`，新增 `GET /api/bots/{bot_id}/sessions` 子路由
- [ ] 3.3 新增 `memoria/server/routes/sessions.py`：`GET /api/sessions/{session_id}/messages`
- [ ] 3.4 修改 `memoria/core/pipeline.py` 的 `query()` 返回值追加 `sources` 字段
- [ ] 3.5 修改 `memoria/server/app.py`：注册 settings / sessions 路由，挂载 `memoria/static/`（目录不存在时跳过并 log warning）

## 4. 前端：项目初始化

- [ ] 4.1 在 `web/` 初始化 React + TypeScript + Vite 项目，配置 `vite.config.ts` 输出到 `../../memoria/static`
- [ ] 4.2 安装 shadcn/ui + Tailwind CSS，配置基础主题
- [ ] 4.3 实现 `src/api.ts`，封装所有 REST 请求（KB、Bot、Documents、Chat、Settings、Sessions）

## 5. 前端：知识库管理页

- [ ] 5.1 KB 列表展示，支持创建 KB（名称 + 描述）和删除 KB
- [ ] 5.2 KB 详情展开文档列表，支持上传 .md/.txt 文件和删除文档，显示 chunk 数量

## 6. 前端：Bot 管理页

- [ ] 6.1 Bot 列表展示，支持创建 Bot（名称 + system_prompt + 关联 KB 多选）
- [ ] 6.2 Bot 编辑表单，支持修改 system_prompt、关联 KB 和 model_override，支持删除 Bot

## 7. 前端：对话页

- [ ] 7.1 Bot 选择器 + 会话列表侧栏（调 `GET /api/bots/{bot_id}/sessions`），支持新建会话
- [ ] 7.2 对话消息区，发送消息、展示 AI 回答
- [ ] 7.3 每条回答下方折叠展示 `sources` 引用片段（doc_id + 文本 + 相关度分数）

## 8. 前端：设置页

- [ ] 8.1 从 `GET /api/settings` 加载当前配置，表单展示所有字段，api_key 显示 `****`
- [ ] 8.2 保存配置调 `PUT /api/settings`，成功后提示"配置已保存，Pipeline 已重建"

## 9. 构建与集成验证

- [ ] 9.1 `npm run build` 输出到 `memoria/static/`，确认 FastAPI 能正常挂载并访问
- [ ] 9.2 完整流程验收：创建 KB → 上传文档 → 创建 Bot → 对话 → 查看引用来源
