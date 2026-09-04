# QQ Gateway 连接限流修复设计

## 问题定位

当前 `QQGateway.run()` 每次 `_run_connection()` 返回后都会将退避重置为 1 秒。Gateway opcode 7 和 opcode 9 都会直接返回，下一轮随即重新获取 `/gateway` URL。服务端连续要求重连时，这条路径会形成 Gateway API 请求风暴并触发 `100017`。同时，`QQBotAdapter.reload()` 可被多个设置请求并发触发，可能创建多个 Gateway 实例。

## 方案

### Gateway 生命周期

- 在 `QQGateway` 内缓存最近一次成功获取的 Gateway URL。
- 连接因 opcode 7/9 正常返回时，`run()` 将其视为受控重连，保留 URL 并使用指数退避；不重新调用 `/gateway`。
- 连接传输异常也使用指数退避；只有 URL 失效、认证失败或需要刷新时才清除 URL并重新获取。
- 处理 Gateway 返回的 `d` 为数字的重连延迟时，使用该延迟作为最小等待时间；否则使用 capped exponential backoff，并加入少量 jitter 避免多个实例同步重试。
- `_stop` 参与所有等待，停止时立即打断重连睡眠。

### Adapter 生命周期

- `start()` 对已运行状态幂等返回。
- 使用生命周期锁串行化 `start()`、`stop()`、`reload()`，避免设置更新与应用关闭交叉创建连接。
- 重载先完整停止旧实例，再按最新配置启动。

## 兼容性与风险

- 不改变鉴权 token 缓存和消息发送 API。
- 不主动清除可恢复会话；仍按 opcode 9 的布尔值决定是否丢弃 session/sequence。
- URL 复用只适用于连接被服务端要求重连的情况；HTTP/认证错误仍可触发 URL 刷新。

## 验证

- 使用 fake websocket 和 monkeypatch 覆盖 opcode 7/9、退避等待、URL 调用次数、stop 中断及 adapter 并发启动。
- 执行 `python -m pytest tests/test_qqbot.py -q`，再执行项目完整测试、ruff 和 mypy（以项目配置为准）。
