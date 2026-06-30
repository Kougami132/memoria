## 修复方案

### 根因

`pipeline.py:39`：

```python
doc_id = os.path.basename(path).replace(".", "_") + "_" + kb_id[:8]
```

`path` 是文件系统路径。vault 同步时传入的是临时文件路径（如 `/tmp/tmpXXXXXX.pdf`），导致 `doc_id` 变为 `tmpXXXXXX_pdf_<kb_id[:8]>`，前端直接展示此字符串即呈现乱码。

### 修复

`display_name` 在同一函数内已正确计算（第 44 行）：

```python
display_name = filename or os.path.basename(path)
```

将 `doc_id` 派生改为使用 `display_name`：

```python
display_name = filename or os.path.basename(path)
doc_id = display_name.replace(".", "_") + "_" + kb_id[:8]
```

注意：`display_name` 的赋值必须移到 `doc_id` 派生之前。

### 影响分析

- 只改 `memoria/core/pipeline.py`，1 个函数内 2 行调整（顺序 + 引用）
- 上传文件（无 `filename` 参数）：`display_name = os.path.basename(path)` 与之前相同，行为不变
- vault 文件：`display_name = filename`（即 `os.path.basename(rel_path)`），`doc_id` 变为可读文件名
- 已有旧向量的 `doc_id` 不受影响，重新 ingest 后更新
