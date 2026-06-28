# Tasks: fix-empty-embed-input

change: fix-empty-embed-input
design-doc: openspec/changes/fix-empty-embed-input/design.md

## Tasks

- [x] pipeline.retrieve()：空 query 时提前返回 []
- [x] pipeline.ingest()：过滤空 chunks，空文件时抛出 ValueError
