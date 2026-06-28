# Tasks: fix-kb-docs-list-and-chat-502

change: fix-kb-docs-list-and-chat-502
design-doc: openspec/changes/fix-kb-docs-list-and-chat-502/design.md

## Tasks

- [x] 在 documents.py 添加 GET /knowledge-bases/{kb_id}/documents 路由
- [x] 在 chat.py 的 502 捕获分支添加 logger.error 记录
