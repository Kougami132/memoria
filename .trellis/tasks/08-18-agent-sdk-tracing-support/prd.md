# 检查 Agent SDK tracing 支持

## Goal

确认当前项目使用的 `openai-agents` SDK 是否自带 tracing 能力，以及 Memoria 是否可以直接基于该 SDK 为 agentic chat 增加 tracing。

## Requirements

- 检查项目中 agent runner 对 SDK tracing 的当前使用方式。
- 检查已安装 / 已声明的 SDK 版本是否包含 tracing API。
- 判断是否可在不重写 agent loop 的前提下启用 tracing。
- 说明默认导出方式、可自定义导出方式、隐私开关和对非 OpenAI base_url 的影响。

## Acceptance Criteria

- [x] 给出“SDK 是否能实现 tracing”的明确结论。
- [x] 列出项目内当前阻塞/关闭 tracing 的代码位置。
- [x] 列出 SDK 提供的关键 tracing API / hook。
- [x] 给出推荐的最小接入方案与风险点。

## Notes

- 本次是可行性调研，暂不直接改业务代码。

