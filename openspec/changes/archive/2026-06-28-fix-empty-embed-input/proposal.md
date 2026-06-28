## Why

`pipeline.retrieve()` 和 `pipeline.ingest()` 均未对空输入做防御，导致向 Embedding API 传入空字符串时返回 400，进而触发 502。

## What Changes

- `pipeline.retrieve()`：query 为空/空白时直接返回 `[]`，跳过 embed 调用
- `pipeline.ingest()`：过滤 chunks 中的空字符串；若过滤后无 chunks，抛出 `ValueError`（返回 422，避免 502）

## Capabilities

### New Capabilities
<!-- 无 -->

### Modified Capabilities
<!-- 行为修复，不改变已有 spec 验收场景 -->

## Impact

- `memoria/core/pipeline.py`：2 处防御性修改
