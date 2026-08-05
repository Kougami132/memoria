# 修复同步删除与修改产生重复文件

## Goal

使 Vault 同步后的知识库文档列表与源目录保持一致，删除或修改源文件时不留下旧文档、旧向量或重复追踪记录。

## Requirements

- 删除源文件并同步后，源文件对应的 `vault_files` 追踪记录、`documents` 记录和 Chroma 向量都必须被清理。
- 修改源文件并同步后，旧文档及其向量必须被替换；同一个 `rel_path` 只能对应一个 `vault_files` 记录和一个 `documents` 记录。
- 同步成功后，前端必须刷新 Vault 状态和文档列表；页面完整刷新后仍必须展示持久化后的正确结果。
- 新增文件、未修改文件、连接失败和取消同步行为不得回归。
- 删除或替换失败时必须保留可恢复的一致追踪状态，并记录包含上下文的错误日志，不能静默吞掉异常。

## Acceptance Criteria

- [ ] 删除源文件并同步后，`vault_files`、`documents` 和对应 Chroma 向量均不存在。
- [ ] 修改源文件并同步后，同一 `rel_path` 仅有一个追踪记录和一个文档，旧文档 ID 不存在。
- [ ] 同步 mutation 成功后，前端失效 `['vault', kbId]` 和 `['docs', kbId]` 查询。
- [ ] 后端同步测试覆盖数据库文档清理和修改替换，而不只验证 mock 方法被调用。
- [ ] 现有后端测试、前端类型检查和生产构建通过。

## Constraints

- 仅修复 Vault 同步删除/修改的一致性及同步后的前端刷新，不重构整个同步架构。
- 保持上传型知识库的现有文档语义和 API 兼容性。

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
