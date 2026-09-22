# 03: 基于 SQLite 任务表的单机持久化异步队列与 202 接口改造 (Persistent Async Task Queue)

**What to build:** 
抽象统一的 `BaseTaskQueue` 接口。默认在单机环境下基于 SQLite `tasks` 持久化表与后台常驻异步 Worker 运行，支持任务状态管理（PENDING/RUNNING/COMPLETED/FAILED）、进度百分比透出与失败重试（最多 3 次）。将耗时的数据解析向量化与 Vault 扫描改造为异步提交，端点立即返回 `202 Accepted` 与 `task_id`，配合任务查询轮询接口消除 Web 界面假死。

**Blocked by:** None (can start immediately)

**Status:** closed

- [x] 定义 `BaseTaskQueue` 统一接口（enqueue, get_task, cancel_task）并实现基于 SQLite 的持久化存储驱动
- [x] 启动内嵌后台 Async Worker，支持消费、异常重试与持久化状态扭转
- [x] 改造耗时端点（如知识库 Ingestion / Vault 同步）返回 202 状态码与 task_id
- [x] 提供任务状态轮询 API (`GET /api/tasks/{id}`) 供前端消费进度与失败信息
- [x] 在 `Task Execution Seam` 编写并通过测试（验证任务持久化入库、后台消费完成、异常重试以及 API 非阻塞响应）
