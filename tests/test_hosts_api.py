import pytest
from fastapi.testclient import TestClient
from memoria.server.app import app
from memoria.server.deps import get_db, get_registry
from memoria.storage.db import DB
from memoria.connectors.registry import ConnectorRegistry


@pytest.fixture
def client(tmp_path):
    db_file = str(tmp_path / "test_api.db")
    test_db = DB(db_file)
    test_registry = ConnectorRegistry()

    app.dependency_overrides[get_db] = lambda: test_db
    app.dependency_overrides[get_registry] = lambda: test_registry

    with TestClient(app) as c:
        yield c

    app.dependency_overrides.clear()


def test_hosts_crud_and_test_api(client):
    # 1. List initial hosts
    res = client.get("/api/hosts")
    assert res.status_code == 200
    assert res.json() == []

    # 2. Create a host
    payload = {
        "name": "Database Node",
        "host": "127.0.0.1",
        "port": 22,
        "username": "admin",
        "auth_type": "password",
        "credential": "secretpassword",
        "description": "Primary PostgreSQL Server",
        "tags": ["prod", "db"],
    }
    res = client.post("/api/hosts", json=payload)
    assert res.status_code == 201
    created = res.json()
    assert created["name"] == "Database Node"
    assert created["tags"] == ["prod", "db"]
    host_id = created["id"]

    # 3. Get single host
    res = client.get(f"/api/hosts/{host_id}")
    assert res.status_code == 200
    assert res.json()["id"] == host_id

    # 4. Update host
    update_payload = {
        "description": "Updated description",
        "port": 2222,
    }
    res = client.put(f"/api/hosts/{host_id}", json=update_payload)
    assert res.status_code == 200
    assert res.json()["description"] == "Updated description"
    assert res.json()["port"] == 2222

    # 5. Test connection
    res = client.post(f"/api/hosts/{host_id}/test")
    assert res.status_code == 200
    assert "status" in res.json()
    assert "latency_ms" in res.json()

    # 6. Delete host
    res = client.delete(f"/api/hosts/{host_id}")
    assert res.status_code == 204

    # Verify deleted
    res = client.get(f"/api/hosts/{host_id}")
    assert res.status_code == 404


def test_bot_with_host_ids(client):
    # Create a host
    res = client.post("/api/hosts", json={
        "name": "Host For Bot",
        "host": "192.168.1.50",
        "port": 22,
    })
    host_id = res.json()["id"]

    # Create Bot associated with host_id
    res = client.post("/api/bots", json={
        "name": "DevOps Bot",
        "system_prompt": "You are a DevOps engineer.",
        "kb_ids": [],
        "host_ids": [host_id],
    })
    assert res.status_code == 201
    bot = res.json()
    assert bot["host_ids"] == [host_id]

    # Get bot
    res = client.get(f"/api/bots/{bot['id']}")
    assert res.status_code == 200
    assert res.json()["host_ids"] == [host_id]
