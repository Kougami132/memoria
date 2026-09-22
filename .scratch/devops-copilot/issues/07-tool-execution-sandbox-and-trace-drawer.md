# 07: 工具阶梯超时熔断、8KB截断与时序 Trace 抽屉 (Tool Sandbox & Execution Trace)

**What to build:** 
为所有工具调用（知识库检索、公网搜索、主机运维命令）注入执行沙箱保护：设置阶梯硬超时（本地 5s、搜索 15s、SSH 30s），实施 8KB 字符防御性输出截断，工具抛出的所有异常统一捕获为 Tool Error 降级返回，杜绝服务崩溃。在交互层透出折叠式 Trace 时序数据，提供每个 Step 的精确毫秒耗时与 Token 指标。

**Blocked by:** 05: HostAgent 异步长任务 Job Handle 与内核危险命令硬拦截 (Host Job Handle & Destructive Guard)

**Status:** closed

- [x] 在统一工具调用分发器实现按工具类型的阶梯式硬超时控制（5s/15s/30s）
- [x] 实现标准输出 8KB 自动防御性截断与尾部提示注入
- [x] 实现全局工具异常捕获降级包装器（Exception -> Tool Error String）
- [x] 在 Turn Response 中携带结构化 Trace Spans（名称、耗时 ms、调用状态）并在前端透出折叠抽屉
- [x] 在 `Orchestrator Turn Seam` 编写并通过测试（测试超时工具的自动掐断、大文本命令的 8KB 截断及异常不崩溃行为）
