# Comet Design Handoff

- Change: web-ui-playground
- Phase: design
- Mode: compact
- Context hash: 195dd0c447fb388856f8d28ee11befe7f6ce97b847f3ef9ba28b214c3f2982fc

Generated-by: comet-handoff.sh

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## openspec/changes/web-ui-playground/proposal.md

- Source: openspec/changes/web-ui-playground/proposal.md
- Lines: 1-35
- SHA256: 07e64b4887b661f9c6d8e1abc370484932423facfb30dd58cd8a36956175b558

```md
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
```

## openspec/changes/web-ui-playground/design.md

- Source: openspec/changes/web-ui-playground/design.md
- Lines: 1-54
- SHA256: 4f06e4fd78ade37538be6b9d51c44de0ea8e7f5ead8fcccad56289d89bd21003

```md
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
```

## openspec/changes/web-ui-playground/tasks.md

- Source: openspec/changes/web-ui-playground/tasks.md
- Lines: 1-51
- SHA256: db4299716738b1d66ca672d52c8ff12b49cb92be01cd171c222bcdbd830fe13c

```md
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
```

## openspec/changes/web-ui-playground/specs/chat-session/spec.md

- Source: openspec/changes/web-ui-playground/specs/chat-session/spec.md
- Lines: 1-19
- SHA256: 8856aeb14245d2217ea237f81eb1b7328f9ecbabd5b8a626c3c92395d7da2386

```md
## ADDED Requirements

### Requirement: 会话列表查询
系统 SHALL 支持按 bot_id 查询该 Bot 下的所有会话，DB 层提供 `list_sessions(bot_id)` 方法。

#### Scenario: 查询指定 Bot 的会话
- **WHEN** 调用 `db.list_sessions(bot_id)`
- **THEN** 返回该 Bot 的所有 session 列表，按 created_at 倒序

### Requirement: 会话消息全量查询
系统 SHALL 提供 `GET /api/sessions/{session_id}/messages` 接口，返回该会话的全量消息，供前端切换会话时加载历史并继续对话。

#### Scenario: 正常返回全量消息
- **WHEN** GET `/api/sessions/{session_id}/messages`
- **THEN** 返回该 session 的所有消息，按 created_at 升序，每项含 `role`、`content`、`created_at`

#### Scenario: 会话不存在时返回 404
- **WHEN** GET `/api/sessions/{non_existent_id}/messages`
- **THEN** 返回 HTTP 404
```

## openspec/changes/web-ui-playground/specs/chat-sources/spec.md

- Source: openspec/changes/web-ui-playground/specs/chat-sources/spec.md
- Lines: 1-12
- SHA256: a25a9d2ec64e08a5d04cc8ab5387e710730cbd20d18c186587b9493b8b40ed1d

```md
## ADDED Requirements

### Requirement: Chat 响应包含引用来源
`POST /api/chat/{bot_id}` 响应 SHALL 新增 `sources` 字段，包含本次 RAG 检索命中的 chunk 列表。

#### Scenario: 有检索结果时返回 sources
- **WHEN** RAG 检索到相关 chunks
- **THEN** 响应包含 `sources: [{text, score, doc_id}]`，按相关度降序排列

#### Scenario: 无检索结果时返回空列表
- **WHEN** Bot 未关联 KB 或检索无命中
- **THEN** 响应 `sources` 为空数组 `[]`，其他字段不受影响
```

## openspec/changes/web-ui-playground/specs/rag-query/spec.md

- Source: openspec/changes/web-ui-playground/specs/rag-query/spec.md
- Lines: 1-12
- SHA256: 29956500ea89d7b19d6e4427142f256caa6fd447921442f5cae40e9ffbcf237b

```md
## MODIFIED Requirements

### Requirement: RAG 单轮问答
系统 SHALL 执行完整 RAG 流程：检索关联 KB → 拼接 context → 调用 LLM → 返回回答，响应包含 `sources` 字段。

#### Scenario: 正常单轮查询
- **WHEN** 调用 `POST /api/chat/{bot_id}`
- **THEN** 返回含 `answer`、`session_id`、`sources`（召回的 chunks，含 text/score/doc_id）的 JSON

#### Scenario: Bot 无关联 KB
- **WHEN** Bot 未关联任何 KB
- **THEN** `sources` 为空数组，仅凭 system_prompt 和问题调用 LLM，正常返回
```

## openspec/changes/web-ui-playground/specs/runtime-settings/spec.md

- Source: openspec/changes/web-ui-playground/specs/runtime-settings/spec.md
- Lines: 1-23
- SHA256: 446e62640b69f45963a5e40b13d21b1805b63ae9428cea722883f7097c2cadf3

```md
## ADDED Requirements

### Requirement: 运行时配置存储
系统 SHALL 将 Web UI 修改的配置项存入 SQLite，覆盖层优先级高于 `.env` 环境变量。

#### Scenario: 覆盖值生效
- **WHEN** DB 中存有 `llm_model` 覆盖值
- **THEN** `GET /api/settings` 返回该覆盖值，Pipeline 使用该值

#### Scenario: 回退到环境变量
- **WHEN** DB 中某字段无覆盖值（为 null 或未设置）
- **THEN** 该字段使用 `.env` 或代码默认值

### Requirement: 配置修改触发 Pipeline 重建
系统 SHALL 在 `PUT /api/settings` 成功后清除 Pipeline 单例并用新配置重建。

#### Scenario: 保存后新对话使用新配置
- **WHEN** 用户将 `top_k` 从 5 改为 3 并保存
- **THEN** 下一次 Chat 请求返回的 `sources` 最多 3 条

#### Scenario: api_key 字段为空时不覆盖
- **WHEN** `PUT /api/settings` 请求中 `api_key` 字段为空字符串或 null
- **THEN** DB 中 api_key 覆盖值不变，继续使用原值
```

## openspec/changes/web-ui-playground/specs/session-list/spec.md

- Source: openspec/changes/web-ui-playground/specs/session-list/spec.md
- Lines: 1-16
- SHA256: 2d0c1bca860c9b5bb00f5c8a5d52bcfe8dfa02cedf60b68079f4292e5659b85d

```md
## ADDED Requirements

### Requirement: 按 Bot 列出会话
系统 SHALL 提供 `GET /api/bots/{bot_id}/sessions` 接口，返回该 Bot 下的所有会话列表，按创建时间倒序。

#### Scenario: 正常返回会话列表
- **WHEN** GET `/api/bots/{bot_id}/sessions`
- **THEN** 返回数组，每项含 `id`、`bot_id`、`created_at`，按 created_at 倒序

#### Scenario: Bot 无会话时返回空数组
- **WHEN** Bot 存在但尚未发起任何对话
- **THEN** 返回 `[]`

#### Scenario: Bot 不存在时返回 404
- **WHEN** GET `/api/bots/{non_existent_id}/sessions`
- **THEN** 返回 HTTP 404
```

## openspec/changes/web-ui-playground/specs/web-ui/spec.md

- Source: openspec/changes/web-ui-playground/specs/web-ui/spec.md
- Lines: 1-68
- SHA256: 7f1c88fe8917cefdd3e380602ab61353ca6eebd6912f2ecc182075c3af5fdaa6

```md
## ADDED Requirements

### Requirement: 静态前端挂载
FastAPI 应用 SHALL 将编译后的 React 静态文件挂载到根路径，API 路径 `/api/*` 优先匹配，其余路径返回 `index.html`。

#### Scenario: 访问根路径
- **WHEN** 用户访问 `http://localhost:8000/`
- **THEN** 返回 `index.html`，前端应用正常加载

#### Scenario: API 路由不受影响
- **WHEN** 请求 `/api/health`
- **THEN** 返回 JSON 响应，不被静态文件处理拦截

### Requirement: 知识库管理页
Web UI SHALL 提供知识库的创建、列表展示和删除功能，以及向指定 KB 上传文档（.md/.txt）、查看文档列表、删除文档的功能。

#### Scenario: 创建知识库
- **WHEN** 用户填写名称并提交
- **THEN** 调用 `POST /api/knowledge-bases`，列表刷新显示新条目

#### Scenario: 上传文档
- **WHEN** 用户选择文件并上传到某 KB
- **THEN** 调用 `POST /api/knowledge-bases/{kb_id}/documents`，成功后显示 chunk 数量

#### Scenario: 删除文档
- **WHEN** 用户点击文档的删除按钮并确认
- **THEN** 调用 `DELETE /api/documents/{doc_id}`，文档从列表移除

### Requirement: Bot 管理页
Web UI SHALL 提供 Bot 的创建、编辑、删除功能，支持关联多个 KB 和配置 system_prompt。

#### Scenario: 创建 Bot
- **WHEN** 用户填写名称、system_prompt，选择关联 KB 后提交
- **THEN** 调用 `POST /api/bots`，Bot 列表刷新

#### Scenario: 编辑 Bot
- **WHEN** 用户修改 Bot 的 system_prompt 或关联 KB 并保存
- **THEN** 调用 `PUT /api/bots/{bot_id}`，展示更新后内容

### Requirement: 对话页
Web UI SHALL 提供选择 Bot、创建/切换会话、发送消息、查看回答及引用片段的能力。

#### Scenario: 新建会话
- **WHEN** 用户选择 Bot 并点击"新建会话"
- **THEN** 发送不带 `session_id` 的请求，响应中的 session_id 记录为当前会话

#### Scenario: 切换历史会话
- **WHEN** 用户从会话列表选择历史会话
- **THEN** 调用 `GET /api/bots/{bot_id}/sessions` 获取列表，切换后加载该 session 的历史消息

#### Scenario: 查看引用来源
- **WHEN** 收到 Chat API 响应
- **THEN** 在回答下方展示 `sources` 列表，每条显示 doc_id 和相关文本片段

### Requirement: 设置页
Web UI SHALL 提供运行时配置的查看和修改入口，字段包括 openai_base_url、api_key、embedding_model、llm_model、top_k、chunk_size、chunk_overlap。

#### Scenario: 加载当前配置
- **WHEN** 用户进入设置页
- **THEN** 调用 `GET /api/settings`，展示当前生效值（覆盖值或环境变量值）

#### Scenario: 修改并保存配置
- **WHEN** 用户修改字段并点击保存
- **THEN** 调用 `PUT /api/settings`，成功后提示"配置已保存，Pipeline 已重建"

#### Scenario: api_key 显示
- **WHEN** settings 页加载时 api_key 已设置
- **THEN** 前端显示 `****`，用户不填写时不覆盖现有值
```

