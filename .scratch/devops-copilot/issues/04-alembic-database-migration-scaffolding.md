# 04: 数据库 ANSI/PostgreSQL 双轨规范化与 Alembic 迁移骨架 (Alembic Migration & Schema Standards)

**What to build:** 
规范所有 SQLAlchemy ORM 模型为 ANSI SQL / PostgreSQL 兼容标准（时间戳使用统一 UTC ISO 格式，JSON 字段采用跨方言标准序列化器），引入 `alembic` 迁移环境与初始化脚本。系统版本迭代时自动执行无损数据迁移，并在保留本地 SQLite 开箱即用能力的同时，支持通过 `DATABASE_URL` 配置直接连接 PostgreSQL。

**Blocked by:** 03: 基于 SQLite 任务表的单机持久化异步队列与 202 接口改造 (Persistent Async Task Queue)

**Status:** closed

- [x] 审查并规范已有 ORM 模型（会话表、消息表、配置表、任务表），确保类型跨 SQLite 与 PostgreSQL 完全兼容
- [x] 搭建 `alembic` 迁移脚手架，生成覆盖当前表结构的基准迁移脚本（Revision Baseline）
- [x] 在应用启动时自动检测并安全执行 `alembic upgrade head`
- [x] 在 `Storage Seam` 编写并通过测试（验证 SQLite 与 PostgreSQL 兼容方言下的无损 Schema 升级与数据回读）
