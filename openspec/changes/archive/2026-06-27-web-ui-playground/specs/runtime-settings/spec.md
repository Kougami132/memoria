## ADDED Requirements

### Requirement: 运行时配置存储
系统 SHALL 将 Web UI 修改的配置项存入 SQLite，覆盖层优先级高于 `.env` 环境变量。

#### Scenario: 覆盖值生效
- **WHEN** DB 中存有 `llm_model` 覆盖值
- **THEN** `GET /api/settings` 返回该覆盖值，Pipeline 使用该值

#### Scenario: 回退到环境变量
- **WHEN** DB 中某字段无覆盖值（为 null 或未设置）
- **THEN** 该字段使用 `.env` 或代码默认值

### Requirement: 配置修改触发 Pipeline 重建
系统 SHALL 在 `PUT /api/settings` 成功后清除 Pipeline 单例并用新配置重建。

#### Scenario: 保存后新对话使用新配置
- **WHEN** 用户将 `top_k` 从 5 改为 3 并保存
- **THEN** 下一次 Chat 请求返回的 `sources` 最多 3 条

#### Scenario: api_key 字段为空时不覆盖
- **WHEN** `PUT /api/settings` 请求中 `api_key` 字段为空字符串或 null
- **THEN** DB 中 api_key 覆盖值不变，继续使用原值
