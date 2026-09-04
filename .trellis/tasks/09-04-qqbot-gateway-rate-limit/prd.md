# 排查并修复 QQ Gateway 频率限制连接问题

## Goal

修复 QQ Bot 在 Gateway 连接断开或配置重载时反复调用 Gateway API，导致 `HTTP 400 / code=100017 / 接口调用超过频率限制`，并确保连接生命周期与参考实现的单连接、可恢复重连模式一致。

## Requirements

- Gateway 运行期间最多存在一个连接任务；重复调用启动或并发重载不能创建并行连接。
- 收到 Gateway 的重连/无效会话信号时，不能立即高频请求 `/gateway`；应保留可复用的 Gateway URL，并按服务端提示或指数退避等待。
- 只有在无法继续使用当前 Gateway URL、token 失效或服务端明确要求时，才重新获取 Gateway URL。
- 停止和重载必须取消旧连接、心跳任务和重连等待，不能在停止后继续发起请求。
- 保留现有消息、心跳、会话恢复和错误上报行为；为关键连接生命周期补充回归测试。

## Acceptance Criteria

- [ ] 连续收到 reconnect/invalid-session 信号时，测试证明不会每次立即调用 `/gateway`，且重连间隔受控。
- [ ] 重连优先复用已获取的 Gateway URL；token 仍有效时不重复请求 token。
- [ ] 并发 `start()`/`reload()` 最终只有一个活动 Gateway 任务和一个连接实例。
- [ ] `stop()` 后不再执行延迟重连。
- [ ] QQBot 现有测试与新增连接生命周期测试通过，项目 lint/type-check 通过。

## Constraints

- 修改范围限于 `memoria/qqbot` 及其测试，除非验证发现启动入口必须配合调整。
- 不改变 QQ Bot 的消息权限、队列、审批和回复协议。
