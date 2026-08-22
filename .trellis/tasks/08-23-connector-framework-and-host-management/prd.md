# PRD: 08-23-connector-framework-and-host-management

## 1. Background & Goals
Memoria 正在从单一的文档 RAG 知识库系统，演进为统一的开发与运维上下文工作台（Context & Ops Hub）。
为了支持未来对 SSH 主机、数据库（SQL/Redis）、API/OpenAPI、代码仓库等多模态资源的统一纳管与调度，本任务旨在建立一套通用的 Connector 抽象框架，并实现第一个示范连接器 Host 管理模块。

主要目标：
1. **连接器框架 (Connector Framework)**：定义统一的资源连接器基类规范 BaseConnector、资源元数据 ResourceMetadata、资源类型 ResourceType 以及全局注册管理器 ConnectorRegistry，实现各类资源的即插即用扩展。
2. **主机管理模块 (Host Connector)**：实现主机资源的配置存储（SQLite hosts 表与 bot_host_links）、凭据管理、连通性探测、基础元数据采集与受控命令执行接口。
3. **Bot 与 Agent 资源绑定**：
   - 扩展 Bot 模型支持绑定主机（host_ids）并保留向后兼容。
   - 扩展 Agent Engine / Agent Tools：常规 Bot 对话根据绑定的 KB 和 Host 动态装载受控工具集；全能 Agent 可访问全量资源工具。
4. **REST API 与测试验证**：提供 /api/hosts 增删改查及测试连接接口，完善单元测试与集成测试。

## 2. Requirements & Scope

### 2.1 Connector 抽象层
- memoria.connectors.base.BaseConnector: 包含 resource_type, resource_id, name, test_connection(), get_summary(), get_tools() 等生命周期和能力接口。
- memoria.connectors.registry.ConnectorRegistry: 统一注册、发现、按类型/ID 检索 Connector 实例。
- 对现有 Knowledge Base 进行 Connector 模式适配（或与现有 Pipeline / Storage 保持兼容）。

### 2.2 Host 存储与连接器实现
- memoria.storage.db.DB: 增加 hosts 表及相关 CRUD 方法（create_host, get_host, list_hosts, update_host, delete_host）及 bot_host_links 关联表与操作。
- memoria.connectors.host.connector.HostConnector: 支持密码或密钥认证配置，提供 test_connection()、get_system_info()、受控命令执行骨架。
- memoria.agents.tools: 提供 Agent/Bot 可调用的主机工具（list_hosts, get_host_info, run_host_command 等），并实现严格的权限作用域校验（Scoped Access）。

### 2.3 Bot 模型与 Agent 运行时
- memoria.models.bot.Bot: 新增 host_ids: list[str] = [] 字段。
- BotRow & DB: 支持 Bot 关联主机并在读取 Bot 时一并返回 host_ids。
- AgentKnowledgeTools / AgentHostTools: 在 create_agent_runner 时根据 Bot 绑定（或全局 Agent）加载相应工具。

### 2.4 REST API
- GET /api/hosts / POST /api/hosts
- GET /api/hosts/{host_id} / PUT /api/hosts/{host_id} / DELETE /api/hosts/{host_id}
- POST /api/hosts/{host_id}/test 或 POST /api/hosts/test

## 3. Acceptance Criteria
- [ ] Connector 抽象体系定义清晰，支持向后扩展其他资源类型（DB、API 等）。
- [ ] SQLite 支持存储 Host 配置并支持 Bot 绑定 Host。
- [ ] /api/hosts 相关 REST API 均正常工作且有完备参数校验。
- [ ] Agent/Bot 工具链能正确根据 Bot 绑定的 host_ids 进行权限限制。
- [ ] 现有单元测试全部通过，且新增 Connector 与 Host 相关测试通过。
