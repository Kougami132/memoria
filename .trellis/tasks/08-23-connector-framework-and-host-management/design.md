# Technical Design: Connector Framework and Host Management

## Architecture Overview

```
Memoria System
  ├── Storage (DB / SQLite)
  │     ├── knowledge_bases, bot_kb_links
  │     ├── hosts (id, name, host, port, username, auth_type, credential, description, ...)
  │     └── bot_host_links (bot_id, host_id)
  │
  ├── Connectors Subsystem (memoria.connectors)
  │     ├── base.py: BaseConnector, ResourceType, ResourceMetadata
  │     ├── registry.py: ConnectorRegistry
  │     ├── host/
  │     │    ├── models.py: HostConfig, HostInfo, CommandResult
  │     │    ├── connector.py: HostConnector (SSH/Mock connection & command execution)
  │     │    └── tools.py: Host-specific agent tool definitions
  │     └── kb/ (adapter / reference)
  │
  ├── Agent Engine & Tools (memoria.agents)
  │     ├── tools.py: Multi-resource tool aggregation (AgentKnowledgeTools + AgentHostTools)
  │     └── engine.py: Tool dispatch & permissions enforcement
  │
  └── Server Routes (memoria.server.routes)
        ├── hosts.py: REST API for Host CRUD and test connection
        ├── bots.py: Support host_ids payload & association
        └── ...
```

## Detailed Component Specifications

### 1. Connector Base & Registry
- `ResourceType`: Enum (`knowledge_base`, `host`, `database`, `api`, etc.)
- `BaseConnector`:
  - `resource_type: ResourceType`
  - `resource_id: str`
  - `name: str`
  - `test_connection() -> dict`
  - `get_summary() -> str`
  - `get_tools() -> list[Any]`
- `ConnectorRegistry`:
  - `register(connector: BaseConnector)`
  - `unregister(resource_type: ResourceType, resource_id: str)`
  - `get(resource_type: ResourceType, resource_id: str) -> BaseConnector | None`
  - `list(resource_type: ResourceType | None = None) -> list[BaseConnector]`

### 2. Database Schema Extensions
- `HostRow(Base)`:
  - `id`: String (UUID or slug)
  - `name`: String
  - `host`: String
  - `port`: Integer (default 22)
  - `username`: String
  - `auth_type`: String (`password` / `key`)
  - `credential`: String (stored or encrypted; masked in public APIs)
  - `description`: String
  - `created_at`: String
  - `updated_at`: String
- `BotHostLink(Base)`:
  - `bot_id`: ForeignKey(bots.id)
  - `host_id`: ForeignKey(hosts.id)

### 3. Agent Tool Scope & Security
- `AgentHostTools`:
  - `list_hosts()`: Returns metadata of allowed hosts.
  - `get_host_info(host_id)`: Fetches OS, uptime, CPU/memory summaries.
  - `run_host_command(host_id, command)`: Executes safe/read-only commands (`uptime`, `uname -a`, `df -h`, `free -m`, `ps aux`, `docker ps`, `netstat -tuln`).
  - Strict check: If `host_id` not in `allowed_host_ids`, raises `HostAccessError`.
