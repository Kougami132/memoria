# QQ Gateway 重连排查记录

## 代码证据

- `memoria/qqbot/gateway.py` 的 `run()` 在 `_run_connection()` 正常返回后将 `backoff` 重置为 `1.0`。
- `_run_connection()` 收到 opcode 7（Reconnect）或 opcode 9（Invalid Session）后直接返回，因此下一轮会马上再次调用 `fetch_gateway_url()`。
- `memoria/qqbot/adapter.py` 的 `reload()` 是 `stop()` 后直接 `start()`，没有锁；设置路由通过 `asyncio.create_task(adapter.reload())` 触发，连续保存配置时可能并发执行。
- 现有回复 API 已对 HTTP 429 使用 `Retry-After`，但 Gateway API 获取 URL 的路径没有同类退避。

## 参考行为

QQ Gateway 的 reconnect/invalid-session 控制帧要求客户端断开并重新建立连接；重连不等于每次都重新申请 Gateway URL。官方 Gateway 客户端通常缓存 URL、维护 session resume 信息，并在失败时采用退避。Invalid Session 的 payload 为布尔值，false 时应丢弃 resume 状态；这一点当前代码已有处理。

## 结论

最小修复是缓存 URL并对受控重连使用可中断指数退避，同时给 adapter 的生命周期操作加锁。这样既降低 `/gateway` 调用频率，也避免配置更新产生多个活动 Gateway。
