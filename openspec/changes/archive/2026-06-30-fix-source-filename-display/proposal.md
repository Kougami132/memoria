## Why

聊天回答的参考来源面板中，文件名显示为乱码（如 `tmp3a8f2c_pdf_abc12345`）。根因是 `pipeline.ingest()` 使用传入的临时文件路径（vault 同步时为 `tempfile.NamedTemporaryFile` 生成的随机名称）来派生 Chroma metadata 中的 `doc_id`，而不是原始文件名。

## What Changes

- `pipeline.py`：`doc_id` 派生改用 `display_name`（即 `filename or os.path.basename(path)`），而非原始 `path` 的 basename

## Capabilities

### New Capabilities
无

### Modified Capabilities
无（仅修复实现细节，不改变已有规格的验收场景）

## Impact

- 受影响文件：`memoria/core/pipeline.py`（1 处）
- 已存储的旧 chunk 向量仍携带旧 `doc_id`，重新 ingest 后才会更新——属于预期行为
- 上传文件（非 vault）本就使用原始文件名，此修复同时保持其行为一致
