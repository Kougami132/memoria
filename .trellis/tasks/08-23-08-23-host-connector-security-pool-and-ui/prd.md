# PRD: Host Connector Security, Connection Pool, and UI Management

## 1. Background & Goals
In the previous iteration, we built the generic BaseConnector / ConnectorRegistry foundation and basic HostConnector.
This phase enhances HostConnector with production-grade security, execution controls, connection caching, and a dedicated Web frontend.

Key objectives:
1. **Credential Security**: Encrypt host credentials (passwords, private keys) at rest in SQLite using an encryption key derived from system secret / settings.
2. **Safe Execution & Guardrails**:
   - Command blacklist/whitelist filtering (prevent destructive operations like m -rf /, mkfs, dd, etc.).
   - Execution timeout (default 15s) and stdout/stderr output truncation (max chars) to protect LLM context windows.
   - Read-only / Safe mode toggle per host.
3. **Lightweight SSH Connection Pool**:
   - Connection cache with TTL / idle eviction (5 min) to avoid repeated SSH handshakes during multi-step ReAct agent calls.
   - Auto-reconnect on broken pipes / dropped sockets.
4. **Web Frontend Integration**:
   - Dedicated Hosts management page in web/ (List, Add, Edit, Delete, Test Connection).
   - Bot configuration modal/drawer integration: add Hosts multi-select alongside Knowledge Bases.
