## Context

Memoria Phase 1 REST API 已完整实现，FastAPI 服务运行于 `http://localhost:8000`。当前体验路径为 Swagger UI 或 curl，摩擦较高。需要在不引入新 Python 依赖、不改变服务启动方式的前提下，增加一个 Web UI 层。

## Goals / Non-Goals

**Goals:**
- React + Vite 前端，构建产物由 FastAPI `StaticFiles` 挂载，单进程，`memoria serve` 启动后直接可用
- 知识库管理、Bot 管理、对话体验（含引用溯源 + 会话切换）、运行时配置四个页面
- 运行时配置覆盖层：DB 优先于 `.env`，保存后重建 Pipeline

**Non-Goals:**
- 多用户 / 权限
- 流式输出
- 移动端

## Decisions

**1. 前端构建产物挂载方式**

React 项目置于 `web/` 目录，`npm run build` 输出到 `memoria/static/`。FastAPI 在 `create_app()` 中挂载：
```python
app.mount("/", StaticFiles(directory="memoria/static", html=True), name="static")
```
SPA 路由通过 `html=True` 由 `index.html` 接管，API 路由 `/api/*` 因注册在前，优先匹配。

**2. 运行时配置存储**

新增 `runtime_settings` SQLite 表（key-value），`GET /api/settings` 合并环境变量与 DB 覆盖值返回，`PUT /api/settings` 写入 DB 后清除 `deps.py` 的 `get_pipeline` lru_cache 并重建。`api_key` 字段为空字符串或 null 时跳过写入。

**3. Pipeline 重建**

`deps.py` 将 `get_pipeline` 改为可重置的模块级变量（不再使用 `@lru_cache`），暴露 `reset_pipeline()` 供 settings 路由调用。`get_db` 保持 `lru_cache` 不变。

**4. Chat API 响应扩展**

`pipeline.query()` 返回值追加 `sources: list[dict]`（每项含 `text`、`score`、`doc_id`），不修改现有字段。`context_chunks` 去掉 `[:settings.top_k]` 二次截断，统一由 `retrieve()` 的 `k` 参数控制。

**5. 会话列表 API**

`db.list_sessions(bot_id)` 查询 `sessions` 表按 `created_at` 倒序，路由注册在 `bots.py` 为子路由 `GET /api/bots/{bot_id}/sessions`。

**6. 前端技术选型**

- React 18 + TypeScript + Vite
- UI：shadcn/ui（基于 Tailwind CSS）—— 精简美观，无过度装饰
- 状态：React Query（服务端状态）+ useState（本地 UI 状态），不引入 Redux
- HTTP：原生 fetch，统一封装 `api.ts`

## Risks / Trade-offs

- **静态文件缺失启动失败**：`memoria serve` 时若 `memoria/static/` 不存在会报错。缓解：挂载时检查目录存在性，不存在时跳过挂载（仅 API 可用），日志提示需先构建前端。
- **Pipeline 重建线程安全**：FastAPI 默认单 worker 模式下无并发写风险；多 worker 部署时重建可能不同步，当前 Phase 不考虑。
- **api_key 安全**：`GET /api/settings` 返回 api_key 时做掩码（`****`），实际值只在服务端使用。
