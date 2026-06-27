## Why

Phase 1 的 REST API 已完整实现，但通过 curl 或 Swagger UI 体验 RAG 效果摩擦极高。需要一个 Web 界面让用户能直接管理数据并体验对话，降低验证成本。

## What Changes

- 新增前端应用（React + Vite），编译为静态文件由 FastAPI 挂载，单进程运行
- 新增运行时配置 API（`GET/PUT /api/settings`），覆盖层优先级高于 `.env`，保存后重建 Pipeline
- 扩展 Chat API 响应，追加 `sources` 字段（引用片段列表）
- 新增会话列表 API（`GET /api/bots/{bot_id}/sessions`）
- DB 层补充 `list_sessions` 方法

## Capabilities

### New Capabilities

- `web-ui`: React 前端，包含知识库管理页、Bot 管理页、对话页、设置页，FastAPI StaticFiles 挂载
- `runtime-settings`: 运行时配置覆盖层，DB 存储，优先级高于 `.env`，修改后触发 Pipeline 重建
- `chat-sources`: Chat API 响应新增 `sources` 字段，透传 RAG 检索到的引用片段（text、score、doc_id）
- `session-list`: 会话列表 API，支持按 Bot 查询历史会话并在 Web UI 中切换

### Modified Capabilities

- `rag-query`: 响应结构新增 `sources` 字段，不破坏现有字段
- `chat-session`: 新增 list sessions 接口

## Impact

- `memoria/server/app.py`：挂载静态文件，注册 settings 路由
- `memoria/server/routes/`：新增 `settings.py`，修改 `chat.py`，修改 `bots.py`（新增 sessions 子路由）
- `memoria/server/deps.py`：Pipeline 单例支持重建
- `memoria/config.py`：新增 RuntimeSettings 覆盖逻辑
- `memoria/storage/db.py`：新增 `list_sessions`
- 新增 `web/` 目录（React 项目），构建产物输出到 `memoria/static/`
- `pyproject.toml`：无新 Python 依赖
