import pytest
from memoria.connectors.base import BaseConnector, ResourceMetadata, ResourceType
from memoria.connectors.registry import ConnectorRegistry
from memoria.connectors.host.connector import HostConnector
from memoria.connectors.host.models import HostConfig, HostInfo, CommandResult
from memoria.connectors.host.tools import AgentHostTools, HostAccessError
from memoria.agents.state import SourceCollector
from memoria.storage.db import DB


class DummyConnector(BaseConnector):
    @property
    def resource_type(self) -> ResourceType:
        return ResourceType.DATABASE

    def test_connection(self):
        return {"status": "success", "latency_ms": 5, "message": "OK"}

    def get_metadata(self):
        return ResourceMetadata(id=self.resource_id, name=self.name, type=self.resource_type)

    def get_summary_for_context(self):
        return f"Database {self.name}"


def test_connector_registry():
    registry = ConnectorRegistry()
    conn1 = DummyConnector("db1", "Main Postgres")
    
    host_cfg = HostConfig(id="host1", name="App Server", host="192.168.1.10")
    conn2 = HostConnector(host_cfg)

    registry.register(conn1)
    registry.register(conn2)

    assert registry.get(ResourceType.DATABASE, "db1") is conn1
    assert registry.get(ResourceType.HOST, "host1") is conn2
    assert len(registry.list()) == 2
    assert len(registry.list(ResourceType.HOST)) == 1

    registry.unregister(ResourceType.DATABASE, "db1")
    assert registry.get(ResourceType.DATABASE, "db1") is None
    assert len(registry.list()) == 1


def test_host_connector_functionality():
    cfg = HostConfig(
        id="srv_01",
        name="Production Node",
        host="127.0.0.1",
        port=22,
        username="deploy",
        tags=["prod", "web"],
    )
    connector = HostConnector(cfg)
    assert connector.resource_type == ResourceType.HOST
    
    meta = connector.get_metadata()
    assert meta.id == "srv_01"
    assert meta.extra["host"] == "127.0.0.1"

    # Test connection
    test_res = connector.test_connection()
    assert "status" in test_res
    assert "latency_ms" in test_res

    # System info & summary
    info = connector.get_system_info()
    assert isinstance(info, HostInfo)
    assert info.host_id == "srv_01"

    summary = connector.get_summary_for_context()
    assert "Production Node" in summary

    # Command execution
    res = connector.execute_command("uptime")
    assert isinstance(res, CommandResult)
    assert res.exit_code == 0
    assert "load average" in res.stdout


def test_agent_host_tools_scoping(tmp_path):
    db_file = str(tmp_path / "test.db")
    db = DB(db_file)

    h1 = db.create_host("Host 1", "10.0.0.1")
    h2 = db.create_host("Host 2", "10.0.0.2")

    collector = SourceCollector()
    
    # Tool scoped only to h1
    tools = AgentHostTools(db=db, allowed_host_ids=[h1["id"]], collector=collector)

    # list_hosts should only see h1
    visible = tools.list_hosts()
    assert len(visible) == 1
    assert visible[0]["id"] == h1["id"]

    # Allowed access to h1
    info = tools.get_host_info(h1["id"])
    assert info["host_id"] == h1["id"]

    # Blocked access to h2
    with pytest.raises(HostAccessError):
        tools.get_host_info(h2["id"])

    with pytest.raises(HostAccessError):
        tools.run_host_command(h2["id"], "uptime")
