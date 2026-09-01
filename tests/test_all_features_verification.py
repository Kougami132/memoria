import json
from unittest.mock import patch
from fastapi.testclient import TestClient
from memoria.server.app import app

def test_full_verification_suite():
    client = TestClient(app)

    # 1. Test Chat API (/v1/chat/completions)
    mock_run_res = {
        "answer": "Mocked chat answer",
        "session_id": "sess-mock-123",
        "used_kbs": [],
        "sources": [],
        "trace": {"spans": [], "summary": {"total_tokens": 42}},
    }

    with patch("memoria.agents.engine.AgenticRagEngine.run", return_value=mock_run_res):
        # 1.1 Non-streaming chat from external client -> should succeed
        res = client.post(
            "/v1/chat/completions",
            json={
                "model": "memoria-agent",
                "messages": [{"role": "user", "content": "hello external"}],
                "stream": False,
            }
        )
        assert res.status_code == 200
        data = res.json()
        assert data["choices"][0]["message"]["content"] == "Mocked chat answer"

    # 2. Test Responses API (/v1/responses)
    mock_events = [
        {"type": "init", "session_id": "sess-test", "message_id": "msg-1"},
        {
            "type": "trace_span",
            "phase": "start",
            "span": {
                "id": "span-sub-1",
                "trace_id": "trace-1",
                "parent_id": "span-root",
                "agent_id": "host_agent",
                "agent_name": "HostAgent",
                "agent_role": "specialist",
                "parent_agent_id": "orchestrator",
                "type": "function",
                "name": "delegate_to_host_agent",
                "started_at": "2026-09-02T12:00:00Z",
                "data": {"instruction": "check uptime"},
            }
        },
        {
            "type": "trace_span",
            "phase": "end",
            "span": {
                "id": "span-sub-1",
                "trace_id": "trace-1",
                "parent_id": "span-root",
                "agent_id": "host_agent",
                "agent_name": "HostAgent",
                "agent_role": "specialist",
                "parent_agent_id": "orchestrator",
                "type": "function",
                "name": "delegate_to_host_agent",
                "started_at": "2026-09-02T12:00:00Z",
                "ended_at": "2026-09-02T12:00:02Z",
                "duration_ms": 2000,
                "data": {"instruction": "check uptime", "output": "load: 0.1"},
            }
        },
        {"type": "thought_delta", "delta": "Thinking about host status..."},
        {"type": "answer_delta", "delta": "Host is healthy."},
        {"type": "done", "trace": {}, "sources": []},
    ]

    with patch("memoria.agents.engine.AgenticRagEngine.run_stream", return_value=iter(mock_events)):
        # 2.1 Streaming from Web Client -> X-Memoria-Client: web
        res_web = client.post(
            "/v1/responses",
            headers={"X-Memoria-Client": "web"},
            json={
                "model": "memoria-agent",
                "input": "check host",
                "stream": True,
            }
        )
        assert res_web.status_code == 200
        web_lines = res_web.text.split("\n")
        
        found_host_agent_start = False
        found_host_agent_done = False
        found_thought = False
        found_text = False

        for line in web_lines:
            if line.startswith("data: ") and not line.endswith("[DONE]"):
                item_data = json.loads(line[6:])
                t = item_data.get("type")
                if t == "response.output_item.added":
                    it = item_data.get("item", {})
                    if it.get("name") == "delegate_to_host_agent":
                        assert it.get("agent_id") == "host_agent"
                        assert it.get("agent_name") == "HostAgent"
                        assert it.get("parent_agent_id") == "orchestrator"
                        assert it.get("type") == "function"
                        found_host_agent_start = True
                elif t == "response.output_item.done":
                    it = item_data.get("item", {})
                    if it.get("name") == "delegate_to_host_agent":
                        assert it.get("agent_id") == "host_agent"
                        assert it.get("duration_ms") == 2000
                        found_host_agent_done = True
                elif t == "response.thought.delta":
                    found_thought = True
                elif t == "response.text.delta":
                    found_text = True

        assert found_host_agent_start, "HostAgent start span was not emitted"
        assert found_host_agent_done, "HostAgent done span was not emitted"
        assert found_thought, "Thought delta was not emitted"
        assert found_text, "Text delta was not emitted"

    # 3. Test Invocations Log API
    logs_res = client.get("/api/logs/invocations")
    assert logs_res.status_code == 200
    logs_data = logs_res.json()
    assert "items" in logs_data
    assert "limit" in logs_data
    assert "offset" in logs_data

    # 4. Test System Logs API
    sys_res = client.get("/api/logs/system")
    assert sys_res.status_code == 200
    sys_data = sys_res.json()
    assert "items" in sys_data
    assert "placeholder" in sys_data

    print("ALL 4 CRITICAL MODULE TESTS PASSED 100%!")

if __name__ == "__main__":
    test_full_verification_suite()
