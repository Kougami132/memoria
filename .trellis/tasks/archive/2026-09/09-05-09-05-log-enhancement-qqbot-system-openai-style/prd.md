# 09-05-log-enhancement-qqbot-system-openai-style

## Goal

构建并完善系统的三维日志体系（外部 API 调用、QQBot 网关连接与消息审计流水、系统运行日志），并在前端严格采用 OpenAI Dashboard 极简风格呈现。

## Requirements

- **存储层 (`memoria/storage/db.py`)**：新增 `QqbotLogRow` 数据结构及表模型，实现 QQBot 事件持久化、多维查询与指标统计接口。
- **QQBot 网关层 (`memoria/qqbot/adapter.py`)**：在适配器生命周期中埋入连接握手、断开与心跳状态，记录私聊与群聊消息收发流水及响应耗时。
- **服务端路由 (`memoria/server/routes/logs.py`)**：暴露 QQBot 状态与事件过滤接口，提供系统运行日志（`data/memoria.log`）逆序 Tail 读取与下载接口。
- **前端界面 (`web/src/pages/Logs.tsx` & `web/src/api.ts`)**：采用 OpenAI 极简风格（纯色系、细边框、分段药丸切换器），提供指标看板、调用日志抽屉、QQBot 审计面板和嵌入式深色系统终端。

## Acceptance Criteria

- [x] SQLite 存储层支持 QQBot 日志的写入、列表查询、类别过滤及清空操作。
- [x] QQBot 适配器具备生命周期状态日志记录与端到端响应耗时追踪。
- [x] `/logs/system` 支持逆序读取指定行数、日志等级过滤与全文关键词检索。
- [x] 前端 Logs 页面提供分段药丸导航、连通性呼吸灯及等宽指标展示。
- [x] 前端构建（`npm run build`）与后端存储单元测试（`pytest`）全部通过。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
