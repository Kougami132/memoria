# 对话系统提示词可配置化

## Goal

 为对话提供可配置的全局默认/兜底系统提示词：用户在“系统设置”页保存后立即生效；新建机器人时预填该默认提示词，Bot 未设置自定义提示词时使用该默认值。

## Requirements

- 系统设置页新增“默认系统提示词”配置项，通过现有 runtime settings 机制持久化。
- `GET /api/settings` 返回 `system_prompt`，`PUT /api/settings` 接受并保存 `system_prompt`。
- 新建机器人时，前端系统提示词输入框预填当前全局默认值，不再使用前端硬编码常量。
- Pipeline 组装对话时，Bot 的 `system_prompt` 为空则使用当前全局默认系统提示词；Bot 已设置自定义提示词时继续以 Bot 配置为准。
- 保存默认系统提示词后，下一次对话立即使用新值，无需重启服务。
- 保持现有 Bot 自定义提示词、RAG 参考资料注入和“思路摘要/回答”输出格式行为不变。
- 空字符串提交沿用现有 settings 语义：删除 runtime override，回退到环境变量或内置默认值。

## Acceptance Criteria

- [ ] `GET /api/settings` 包含 `system_prompt`，默认值与当前内置默认提示词一致。
- [ ] `PUT /api/settings` 写入 `system_prompt` 后，后续 `GET /api/settings` 返回新值。
- [ ] 创建 `system_prompt=""` 的 Bot 后，对话请求构造的系统消息包含全局默认提示词。
- [ ] 创建 `system_prompt="custom"` 的 Bot 后，对话请求构造的系统消息仍以 `custom` 开头，不因全局默认值改变而覆盖。
- [ ] Bots 创建表单使用 `/api/settings` 返回的 `system_prompt` 预填新 Bot 输入框。
- [ ] 后端测试覆盖 settings 返回/覆盖与 Pipeline 兜底行为。
- [ ] 现有后端测试、前端 lint/type-check/build 和生产构建产物更新通过。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
