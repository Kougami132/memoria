# QQ 群审批身份绑定验证

## 结论

群审批不需要等到业务实现后才判断协议是否支持。结合 Hermes 的官方 QQ Bot API v2 适配器源码、QQ 官方 Gateway 文档和腾讯官方 BotPy 类型定义，可以在调研阶段确认：QQ 的群消息和内联键盘交互都提供了建立审批身份绑定所需的字段。

实现阶段仍然需要做真实 App 权限开通和 Gateway 联调，但那是运行时验证，不是协议可行性验证。如果运行时收到的事件缺少可靠的点击者身份，群审批必须继续默认拒绝。

## Hermes 源码证据

仓库：<https://github.com/NousResearch/hermes-agent>

相关文件：

- `gateway/platforms/qqbot/adapter.py`
- `gateway/platforms/qqbot/keyboards.py`

Hermes 的群消息处理从事件中读取 `group_openid` 和 `author.member_openid`，并把成员 OpenID 放入标准化消息的 `user_id`。这说明群共享会话可以以 `group_openid` 为会话键，同时保留发言人的可信身份元数据。

Hermes 的审批按钮使用 QQ 内联键盘回调，按钮数据形如：

```text
approve:<session_key>:allow-once
approve:<session_key>:allow-always
approve:<session_key>:deny
```

按钮点击由 `INTERACTION_CREATE` 事件传入。Hermes 解析以下字段：

- 顶层 `group_openid`
- 顶层 `group_member_openid`
- 顶层 `user_openid`
- `data.resolved.button_data`
- `data.resolved.button_id`
- `data.resolved.user_id`

Hermes 不是只解析字段，而是实际执行授权校验：

- C2C：点击者必须等于会话绑定的用户；
- 群聊：事件中的群必须等于审批会话所属群，点击者必须等于发起审批的群成员；
- 校验通过后才调用 `resolve_gateway_approval(session_key, choice)`。

因此 Hermes 的群审批会话并非只有群 ID，而是同时绑定发起审批的成员身份。按钮数据负责定位审批请求，点击者身份来自 Gateway 事件，二者共同组成授权依据。

## QQ 官方证据

官方 Gateway 事件文档：
<https://bot.q.qq.com/wiki/develop/api-v2/dev-prepare/interface-framework/event-emit.html>

该文档定义统一 Gateway Payload `id/op/d/s/t`、事件订阅 Intents，以及 `GROUP_AND_C2C_EVENT` 和 `INTERACTION` 事件类别。`GROUP_AND_C2C_EVENT` 覆盖 `C2C_MESSAGE_CREATE` 和 `GROUP_AT_MESSAGE_CREATE`，`INTERACTION` 覆盖 `INTERACTION_CREATE`。

腾讯官方 BotPy 类型定义：
<https://github.com/tencent-connect/botpy/blob/master/botpy/types/interaction.py>

`InteractionPayload` 明确定义了：

```python
group_openid: str
group_member_openid: str
user_openid: str
data: InteractionData
```

同一类型文件定义 `InteractionType.INLINE_KEYBOARD = 11` 和 `InteractionDataType.INLINE_KEYBOARD_BUTTON_CLICK = 11`。官方 `botpy/types/gateway.py` 定义的 `MessagePayload` 也包含消息作者、消息 ID、内容、成员和附件等标准 Gateway 消息字段。

这份官方 SDK 类型定义是独立于 Hermes 的证据：群成员身份字段属于 QQ 官方交互事件模型，不是 Hermes 自己扩展出来的字段。

## 审批绑定模型

Memoria 应将审批请求绑定为至少以下数据：

```text
approval_id/session_key
qq_app_id
scene: c2c | group
context_id: user_openid | group_openid
initiating_member_openid
expires_at
```

收到按钮事件后，必须同时校验：

1. 审批请求仍存在且未过期；
2. 按钮数据中的审批 ID 有效，决策值属于白名单；
3. 事件场景和目标上下文与审批请求一致；
4. C2C 的点击者等于发起用户；
5. 群聊的点击者等于发起审批的群成员；
6. 校验失败时不得调用审批解析函数。

群会话仍按 `group_openid` 共享。审批身份绑定只约束这一次高风险操作，不改变普通 QQ 消息与系统 Agent 的能力集合。

## 私聊与群聊差异

私聊审批的身份关系天然是一对一的：发起审批的用户、审批消息的目标用户和按钮点击者可以使用同一个 `user_openid` 校验。因此用户已经验证私聊审批可用，与协议模型一致。

群聊审批虽然协议上支持安全绑定，但需要确认当前 App 已获得 `INTERACTION` 事件权限，并确认线上收到的事件始终带有非空且可对应的 `group_member_openid` 或等价可靠身份。若当前事件只提供群上下文而没有可靠操作人身份，不能把“群内任意成员点击”视为授权。

## 调研阶段与实现阶段的边界

调研阶段已经可以确认：

- QQ 能推送群消息和内联键盘交互事件；
- 事件模型包含群 ID、群成员身份和按钮数据；
- Hermes 已经用同类字段实现了群审批身份校验；
- Memoria 可以采用相同的绑定模型，而不需要引入 NapCat、OneBot 或 Bot 映射。

实现阶段仍需确认：

- QQ App 是否实际开通 `GROUP_AND_C2C_EVENT` 与 `INTERACTION` 权限；
- Identify 使用的 intents 是否与 App 权限一致；
- 当前环境收到的 `INTERACTION_CREATE` 是否稳定携带点击者身份；
- ACK 接口、限时和不同场景下的字段表现是否符合当前官方版本。

这些是权限和运行时联调问题，不能通过静态源码完全替代，但不再构成“协议未知”。

## 默认策略

- 私聊审批：支持绑定发起用户后启用。
- 群聊审批：只有实现了发起成员绑定并通过事件身份校验时启用。
- 群聊事件缺失可靠点击者身份、审批过期、上下文不匹配或权限不明确：默认拒绝。
- Web 管理员审批可以作为单独、显式的审批通道，不应悄悄绕过 QQ 群成员身份校验。
