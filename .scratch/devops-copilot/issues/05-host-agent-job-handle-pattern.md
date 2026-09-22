# 05: HostAgent 异步长任务 Job Handle 与内核危险命令硬拦截 (Host Job Handle & Destructive Guard)

**What to build:** 
为 `HostAgent` 增加异步任务句柄模式，解决长耗时命令（持续抓包、日志流追踪、构建部署）阻塞请求的问题。命令执行可派生受控后台会话并返回 `job_id`，提供 `get_job_status(job_id)` 与 `read_job_output(job_id)` 供增量消费；在执行器内核加入硬阻断名单，对自毁类操作（`rm -rf /`、格式化、修改 root 密码等）强制拦截阻断。

**Blocked by:** None (can start immediately)

**Status:** closed

- [x] 实现受控后台进程 Job 状态机（支持派生、状态查询、增量日志读取与终止）
- [x] 为 HostAgent 注册 `get_job_status` 与 `read_job_output` 工具
- [x] 在 `HostCommandGuard` 内核层建立不可绕过的自毁指令黑名单硬拦截规则
- [x] 在 `Orchestrator Turn Seam` 编写并通过测试（验证长命令正确返回 job_id 并可轮询日志，验证高危命令无论权限模式均被硬拦截）
