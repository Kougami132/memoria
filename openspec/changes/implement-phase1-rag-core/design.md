## Context

项目骨架已就位（pyproject.toml、模型类、配置、路由骨架），所有核心模块均为 `NotImplementedError`。DESIGN.md 已定义架构和 ADR，本文档聚焦实现层决策。

## Goals / Non-Goals

**Goals:**
- 填充所有 stub 实现，使 RAG 全流程端到端可运行
- 有状态多轮对话（session_id + SQLite 消息历史）
- mock 模式：`USE_MOCK=true` 时用 stub 替换 embedder 和 LLM，测试无需真实 API
- 仅支持 `.md` / `.txt` 文件格式
- pytest 全部通过

**Non-Goals:**
- PDF / DOCX 解析
- Reranker
- Phase 2 Agentic RAG
- Web UI / QQ Bot 接入

## Decisions

### 1. SQLite Schema

6 张表，SQLAlchemy ORM 定义，首次启动 `Base.metadata.create_all()` 自动建表：

```
bots            (id TEXT PK, name TEXT, system_prompt TEXT, model_override TEXT, created_at TEXT)
knowledge_bases (id TEXT PK, name TEXT, description TEXT, created_at TEXT)
bot_kb_links    (bot_id TEXT FK, kb_id TEXT FK, PRIMARY KEY(bot_id, kb_id))
documents       (id TEXT PK, kb_id TEXT FK, filename TEXT, path TEXT, chunk_count INT, created_at TEXT)
sessions        (id TEXT PK, bot_id TEXT FK, created_at TEXT)
messages        (id TEXT PK, session_id TEXT FK, role TEXT, content TEXT, created_at TEXT)
```

使用 `uuid4()` 生成所有实体 ID。

### 2. Mock 模式实现

`config.py` 新增 `use_mock: bool = False`，从环境变量 `USE_MOCK` 读取。

- `MockEmbedder`：返回固定长度随机向量（与真实维度相同：1536）
- `MockLLMCaller`：返回固定字符串 `"[mock response]"`，streaming 版本逐字符 yield
- `pipeline.py` 的 `ingest`/`query` 根据 `settings.use_mock` 选择实现

### 3. 多轮对话 Session 设计

```
POST /api/chat/{bot_id}
Body: {"message": "...", "session_id": "optional"}

流程：
1. session_id 为空 → 创建新 session，返回新 session_id
2. 从 DB 查询该 session 的历史 messages（role: user/assistant）
3. 历史消息拼入 prompt（最近 N 条，N=10 默认）
4. 检索所有关联 KB → 合并 top-k chunks
5. 构建 messages 列表：system_prompt + 历史 + context + 当前问题
6. LLM 回答 → 存入 messages 表 → 返回
```

### 4. DB 封装方式

`storage/db.py` 不使用通用基类，直接按表实现具名方法：

```python
class DB:
    # KB
    def create_kb(self, name, description) -> KBRow
    def get_kb(self, kb_id) -> KBRow | None
    def list_kbs(self) -> list[KBRow]
    def delete_kb(self, kb_id) -> None
    # Bot
    def create_bot(self, name, system_prompt, kb_ids, model_override) -> BotRow
    def get_bot(self, bot_id) -> BotRow | None
    ...
    # Session / Messages
    def create_session(self, bot_id) -> SessionRow
    def get_messages(self, session_id, limit=10) -> list[MessageRow]
    def add_message(self, session_id, role, content) -> None
```

理由：通用 CRUD 基类对多对多关系（bot_kb_links）和 session/message 组合操作不自然。

### 5. FastAPI 依赖注入

`server/deps.py` 提供 `get_db()` 和 `get_pipeline()` 两个依赖，路由通过 `Depends()` 获取，便于测试时替换。

### 6. 文件上传处理

`POST /api/knowledge-bases/{kb_id}/documents` 使用 `UploadFile`，写入 `settings.upload_dir/{kb_id}/` 后调用 `pipeline.ingest()`。仅允许 `.md` / `.txt`，其他格式返回 422。

## Risks / Trade-offs

- **Chroma 并发写入** → Phase 1 单进程，不涉及并发，风险低
- **删除 KB 一致性** → 先删 Chroma collection，再删 SQLite；失败时记录错误日志，不做回滚（Phase 1 可接受）
- **Session 消息无上限** → 默认取最近 10 条，超长对话不会撑爆 prompt
- **mock 向量维度** → MockEmbedder 固定 1536 维，与 ChromaStore 的 collection 维度必须一致；测试时每次用新 collection name 避免冲突

## Migration Plan

1. 实现各模块（顺序：storage → core → llm → server → cli → tests）
2. 每个模块完成后运行 `pytest tests/ -q` 确认不回归
3. 测试使用 `USE_MOCK=true`，无需真实 API
4. 最终 `memoria serve` 启动验证接口可用

## Open Questions

- 无（已与用户澄清完毕）
