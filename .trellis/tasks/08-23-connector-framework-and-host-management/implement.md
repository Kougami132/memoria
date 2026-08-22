# Implementation Plan: Connector Framework and Host Management

## Execution Steps

1. **Step 1: Connector Framework Core**
   - Create package `memoria.connectors`.
   - Implement `memoria/connectors/base.py` (`ResourceType`, `BaseConnector`, `ResourceMetadata`).
   - Implement `memoria/connectors/registry.py` (`ConnectorRegistry`).

2. **Step 2: Storage Extensions**
   - In `memoria/storage/db.py`:
     - Add `HostRow` and `BotHostLink` ORM models.
     - Implement CRUD methods: `create_host`, `get_host`, `list_hosts`, `update_host`, `delete_host`, `link_bot_hosts`, `get_bot_hosts`.
     - Update `get_bot`, `list_bots`, `create_bot`, `update_bot` to handle `host_ids`.

3. **Step 3: Host Connector Implementation**
   - Implement `memoria/connectors/host/models.py`.
   - Implement `memoria/connectors/host/connector.py` with mock / fallback support and connection testing.
   - Implement `memoria/connectors/host/tools.py` (`AgentHostTools`).

4. **Step 4: Bot & Agent Engine Multi-Resource Integration**
   - Update `memoria/models/bot.py` to include `host_ids: list[str] = []`.
   - In `memoria/agents/tools.py`:
     - Aggregate `AgentKnowledgeTools` and `AgentHostTools`.
     - Export comprehensive tool definitions and registry.
   - In `memoria/agents/engine.py`:
     - Wire allowed KB and Host tools dynamically based on Bot config or global Agent flags.

5. **Step 5: Server REST APIs**
   - Implement `memoria/server/routes/hosts.py` with endpoints:
     - `GET /api/hosts`
     - `POST /api/hosts`
     - `GET /api/hosts/{host_id}`
     - `PUT /api/hosts/{host_id}`
     - `DELETE /api/hosts/{host_id}`
     - `POST /api/hosts/{host_id}/test`
   - Include router in `memoria/server/app.py`.
   - Update `memoria/server/routes/bots.py` to accept and serialize `host_ids`.

6. **Step 6: Testing & Verification**
   - Add unit tests for `connectors/base.py` & `registry.py`.
   - Add DB tests for `hosts` and `bot_host_links`.
   - Add Agent tools access control tests.
   - Add API router tests for `/api/hosts` and `/api/bots`.
   - Run complete test suite (`pytest`) to ensure no regressions.
