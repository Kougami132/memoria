# Current System Prompt Behavior

## Findings

- Bot system prompts are already stored per Bot in the SQLite `bots.system_prompt` column.
- The web UI already exposes `system_prompt` in the Bots page create/edit form.
- `Pipeline.prepare_query` reads `bot["system_prompt"]` from the database on every request, so an updated Bot prompt is effective without a service restart.
- The pipeline then appends hardcoded sections:
  - `参考资料：\n{context}` when RAG chunks are available
  - `输出格式（必须遵守）：\n### 思路摘要\n...\n### 回答\n...`
- The frontend default prompt used when creating a new Bot is a constant in `web/src/pages/Bots.tsx` (`DEFAULT_SYSTEM_PROMPT`).
- There is no global/default system prompt setting in the Settings page or runtime settings.
- `react_mini.py` and `rag_mini.py` are standalone demo scripts, not the served application.

## Relevant Files

- `web/src/pages/Bots.tsx`
- `web/src/pages/Chat.tsx`
- `web/src/pages/Settings.tsx`
- `web/src/api.ts`
- `memoria/server/routes/bots.py`
- `memoria/server/routes/settings.py`
- `memoria/core/pipeline.py`
- `memoria/config.py`
- `memoria/storage/db.py`
