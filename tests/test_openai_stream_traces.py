import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock
from memoria.server.app import app
import json

def test_openai_responses_stream_emits_subagent_spans():
    client = TestClient(app)
    
    mock_events = [
        {"type": "init", "session_id": "sess-123", "message_id": "msg-1"},
        {
            "type": "trace_span",
            "phase": "start",
            "span": {
                "id": "span-kb-1",
                "trace_id": "trace-1",
                "parent_id": "span-agent-1",
                "agent_id": "knowledge_agent",
                "agent_name": "KnowledgeAgent",
                "agent_role": "specialist",
                "parent_agent_id": "orchestrator",
                "type": "function",
                "name": "delegate_to_knowledge_agent",
                "started_at": "2026-09-02T12:00:00Z",
                "data": {"query": "test query"},
            }
        },
        {
            "type": "trace_span",
            "phase": "end",
            "span": {
                "id": "span-kb-1",
                "trace_id": "trace-1",
                "parent_id": "span-agent-1",
                "agent_id": "knowledge_agent",
                "agent_name": "KnowledgeAgent",
                "agent_role": "specialist",
                "parent_agent_id": "orchestrator",
                "type": "function",
                "name": "delegate_to_knowledge_agent",
                "started_at": "2026-09-02T12:00:00Z",
                "ended_at": "2026-09-02T12:00:01Z",
                "duration_ms": 1000,
                "data": {"query": "test query", "output": "found chunks"},
            }
        },
        {"type": "answer_delta", "delta": "Here is the answer."},
        {"type": "done", "trace": {}, "sources": []},
    ]

    with patch("memoria.agents.engine.AgenticRagEngine.run_stream", return_value=iter(mock_events)):
        response = client.post(
            "/v1/responses",
            headers={"X-Memoria-Client": "web"},
            json={
                "model": "memoria-agent",
                "input": "test prompt",
                "stream": True,
            },
        )
        assert response.status_code == 200
        content = response.text
        lines = content.split("\n")
        
        found_start_span = False
        found_end_span = False
        
        for line in lines:
            if line.startswith("data: ") and not line.endswith("[DONE]"):
                data = json.loads(line[6:])
                if data.get("type") == "response.output_item.added" and data.get("item", {}).get("name") == "delegate_to_knowledge_agent":
                    found_start_span = True
                    item = data["item"]
                    assert item["agent_id"] == "knowledge_agent"
                    assert item["agent_name"] == "KnowledgeAgent"
                    assert item["parent_agent_id"] == "orchestrator"
                    assert item["type"] == "function"
                elif data.get("type") == "response.output_item.done" and data.get("item", {}).get("name") == "delegate_to_knowledge_agent":
                    found_end_span = True
                    item = data["item"]
                    assert item["status"] == "completed"
                    assert item["duration_ms"] == 1000
                    assert item["agent_id"] == "knowledge_agent"
                    assert item["agent_name"] == "KnowledgeAgent"

        assert found_start_span, "Subagent start span not emitted in SSE stream"
        assert found_end_span, "Subagent end span not emitted in SSE stream"
