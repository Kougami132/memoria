## MODIFIED Requirements

### Requirement: 配置模板存在
项目 SHALL 提供 `.env.example` 文件，包含所有必要的配置项占位符，且不含真实密钥。新增 `USE_MOCK` 配置项。

#### Scenario: 配置模板完整性
- **WHEN** 用户查看 `.env.example`
- **THEN** 文件包含 NEWAPI_BASE_URL、NEWAPI_API_KEY、EMBEDDING_MODEL、LLM_MODEL、CHUNK_SIZE、CHUNK_OVERLAP、TOP_K、DB_PATH、CHROMA_PATH、UPLOAD_DIR、USE_MOCK 等配置项
