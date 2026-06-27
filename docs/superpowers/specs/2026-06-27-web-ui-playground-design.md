---
comet_change: web-ui-playground
role: technical-design
canonical_spec: openspec
---

# Design Doc: web-ui-playground

## 目标

为 Memoria Phase 1 REST API 构建 Web UI，让用户无需 curl/Swagger 即可完整体验 RAG 能力：管理知识库和 Bot、上传文档、与 Bot 对话并查看引用溯源、切换历史会话、运行时修改配置。

## 架构概览

```
memoria serve
    │
    ├─ FastAPI
    │   ├─ /api/*          (REST API，优先匹配)
    │   └─ /*              (StaticFiles → index.html，SPA 路由)
    │
web/ (React + Vite 源码)
    └─ npm run build → memoria/static/
```

单进程，`memoria serve` 启动后直接访问 `http://localhost:8000`。`memoria/static/` 不存在时 log warning 并跳过挂载，API 仍正常工作。

---

## 后端设计

### 1. DB 层扩展 (`memoria/storage/db.py`)

新增 ORM 模型：

```python
class RuntimeSettingRow(Base):
    __tablename__ = "runtime_settings"
    key = Column(String, primary_key=True)
    value = Column(String, nullable=False)
    updated_at = Column(String, nullable=False)
```

`Base.metadata.create_all` 在 `DB.__init__` 中自动建表，无需迁移脚本。

新增方法：
- `get_setting(key: str) -> str | None`
- `set_setting(key: str, value: str) -> None`
- `get_all_settings() -> dict[str, str]` — 返回所有覆盖值的 key-value 字典
- `list_sessions(bot_id: str) -> list[dict]` — 按 `created_at` 倒序
- `get_messages_all(session_id: str) -> list[dict]` — 全量消息，按 `created_at` 升序，无 limit

### 2. 配置覆盖层 (`memoria/config.py`)

新增函数：

```python
def get_effective_settings(db: DB) -> dict:
    overrides = db.get_all_settings()
    base = settings  # pydantic Settings 实例
    result = {}
    for field in ["openai_base_url", "openai_api_key", "embedding_model",
                  "llm_model", "top_k", "chunk_size", "chunk_overlap"]:
        env_val = getattr(base, field if field != "openai_api_key" else "openai_api_key")
        result[field] = overrides.get(field, str(env_val))
    return result
```

`GET /api/settings` 的 `api_key` 字段映射到 `openai_api_key`，返回明文（本地单用户服务）。

### 3. Pipeline 重建 (`memoria/server/deps.py`)

将 `get_pipeline` 改为 `lru_cache(maxsize=1)` + `reset_pipeline()` 调 `cache_clear()`：

```python
@lru_cache(maxsize=1)
def get_pipeline() -> Pipeline:
    db = get_db()
    effective = get_effective_settings(db)
    # 用 effective 里的值构建 Embedder / LLMCaller
    ...

def reset_pipeline() -> None:
    get_pipeline.cache_clear()
```

`get_db` 保持 `@lru_cache` 不变。

### 4. 新增 / 修改路由

**`memoria/server/routes/settings.py`（新增）**

```
GET  /api/settings     → get_effective_settings(db)，api_key 返回明文
PUT  /api/settings     → 遍历 payload，非空字段写 DB，api_key 空值跳过，最后调 reset_pipeline()
```

请求体：
```python
class SettingsUpdate(BaseModel):
    openai_base_url: str | None = None
    api_key: str | None = None          # 空字符串或 None 时跳过写入
    embedding_model: str | None = None
    llm_model: str | None = None
    top_k: int | None = None
    chunk_size: int | None = None
    chunk_overlap: int | None = None
```

**`memoria/server/routes/bots.py`（修改）**

新增子路由：
```
GET /api/bots/{bot_id}/sessions → db.list_sessions(bot_id)，bot 不存在返回 404
```

**`memoria/server/routes/chat.py` + `memoria/server/routes/sessions.py`（新增）**

新增路由文件 `sessions.py`：
```
GET /api/sessions/{session_id}/messages → db.get_messages_all(session_id)，session 不存在返回 404
```

**`memoria/core/pipeline.py`（修改）**

`query()` 返回值追加 `sources` 字段：

```python
return {
    "answer": answer,
    "session_id": session_id,
    "sources": [{"text": c["text"], "score": c["score"], "doc_id": c["metadata"]["doc_id"]}
                for c in context_chunks],
}
```

**`memoria/server/app.py`（修改）**

```python
from memoria.server.routes import bots, chat, documents, knowledge_bases, settings, sessions
import os, logging

def create_app() -> FastAPI:
    app = FastAPI(title="Memoria")
    app.include_router(knowledge_bases.router, prefix="/api")
    app.include_router(bots.router, prefix="/api")
    app.include_router(documents.router, prefix="/api")
    app.include_router(chat.router, prefix="/api")
    app.include_router(settings.router, prefix="/api")
    app.include_router(sessions.router, prefix="/api")

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    static_dir = os.path.join(os.path.dirname(__file__), "static")
    if os.path.isdir(static_dir):
        from fastapi.staticfiles import StaticFiles
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
    else:
        logging.warning("memoria/static/ not found — Web UI unavailable. Run `npm run build` in web/.")

    return app
```

---

## 前端设计

### 项目结构

```
web/
├── src/
│   ├── api.ts                  # 所有 fetch 封装，baseURL = /api
│   ├── App.tsx                 # react-router-dom，4 个页面路由
│   ├── components/
│   │   └── Layout.tsx          # 顶部导航 + 页面容器
│   └── pages/
│       ├── KnowledgeBases.tsx
│       ├── Bots.tsx
│       ├── Chat.tsx
│       └── Settings.tsx
├── vite.config.ts              # build.outDir: "../memoria/static"
│                               # dev: proxy /api → http://localhost:8000
└── package.json
```

### 技术栈

- React 18 + TypeScript + Vite
- shadcn/ui（基于 Tailwind CSS v3）
- TanStack Query（React Query v5）— 服务端状态缓存与 invalidation
- react-router-dom v6 — SPA 路由

### 页面设计

**知识库管理页**
- KB 列表卡片，每张卡片可展开文档列表
- "创建 KB" 内联表单（名称 + 描述）
- 文档上传：drag-and-drop 或点击，仅接受 `.md`/`.txt`，上传成功显示 chunk 数
- 删除 KB / 删除文档均有确认提示

**Bot 管理页**
- Bot 列表卡片，点击进入编辑模式
- 创建/编辑表单：名称、system_prompt（textarea）、关联 KB（多选 checkbox）、model_override（可选）
- 删除有确认提示

**对话页**

```
┌──────────────────────────────────────────────────────┐
│  Bot: [下拉选择]                                      │
├──────────────────┬───────────────────────────────────┤
│  [+ 新建会话]    │  消息区（flex-col, overflow-y）   │
│  ─────────────   │                                   │
│  会话 1          │  user: 你好                       │
│  会话 2          │  assistant: 你好！...             │
│  会话 3          │    ▶ 引用来源（可折叠）            │
│                  │    ├ doc_id | score: 0.91         │
│                  │    └ 文本片段...                  │
│                  │                                   │
│                  │  ┌─────────────────────┐ [发送]  │
│                  │  │ 输入框              │         │
│                  │  └─────────────────────┘         │
└──────────────────┴───────────────────────────────────┘
```

- 切换 Bot 时清空会话列表并重新拉取
- 切换会话时调 `GET /api/sessions/{session_id}/messages` 加载历史，渲染后可继续发消息
- 新建会话：第一条消息发出后（响应含 session_id），将 session 加入列表并选中
- `sources` 折叠展示，默认收起

**设置页**
- 表单展示所有配置字段
- `api_key` 字段：默认 `type="password"`（显示 `****`），右侧眼睛 icon 切换 `type="text"`/`"password"`
- 提交时若 `api_key` 字段未被修改（仍为初始加载的明文值）则不发送该字段，避免误覆盖
- 保存成功后 toast 提示"配置已保存，Pipeline 已重建"

### api.ts 接口一览

```typescript
// 知识库
listKBs() → GET /api/knowledge-bases
createKB(name, description) → POST /api/knowledge-bases
deleteKB(id) → DELETE /api/knowledge-bases/{id}
uploadDocument(kbId, file) → POST /api/knowledge-bases/{kbId}/documents (multipart)
deleteDocument(docId) → DELETE /api/documents/{docId}

// Bot
listBots() → GET /api/bots
createBot(data) → POST /api/bots
updateBot(id, data) → PUT /api/bots/{id}
deleteBot(id) → DELETE /api/bots/{id}
listSessions(botId) → GET /api/bots/{botId}/sessions

// Chat
chat(botId, message, sessionId?) → POST /api/chat/{botId}
getMessages(sessionId) → GET /api/sessions/{sessionId}/messages

// Settings
getSettings() → GET /api/settings
updateSettings(data) → PUT /api/settings
```

---

## 开发工作流

```bash
# 后端开发
memoria serve   # http://localhost:8000

# 前端开发（proxy 到后端）
cd web && npm run dev   # http://localhost:5173，/api/* 代理到 :8000

# 构建集成
cd web && npm run build   # 输出到 memoria/static/
memoria serve             # 访问 http://localhost:8000 即可
```

---

## 风险与取舍

| 风险 | 缓解 |
|------|------|
| `get_messages_all` 无 limit，历史过长 | 当前 Phase 接受；后续可加虚拟滚动 |
| `lru_cache` 非严格线程安全 | 单 worker 部署无问题；多 worker 另评估 |
| `GET /api/settings` 返回明文 api_key | 本地单用户服务，明确非目标多用户场景 |
| 静态文件未构建时 UI 不可用 | log warning，API 正常，文档说明构建步骤 |
