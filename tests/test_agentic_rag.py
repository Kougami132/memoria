from unittest.mock import MagicMock

from fastapi.testclient import TestClient

from memoria.agents.engine import AgenticRagEngine, OpenAIAgentsRunner
from memoria.agents.state import SourceCollector
from memoria.agents.tools import AgentKnowledgeTools, KnowledgeBaseAccessError
from memoria.config import get_effective_settings
from memoria.core.embedder import MockEmbedder
from memoria.core.pipeline import Pipeline
from memoria.llm.caller import MockLLMCaller
from memoria.server.app import create_app
from memoria.server.deps import get_agentic_engine, get_db, get_pipeline
from memoria.storage.db import DB


class FakeRunner:
    def __init__(self):
        self.calls = []

    def run(self, message, instructions, tools, model_name):
        kbs = tools.list_knowledge_bases()
        self.calls.append({
            "message": message,
            "instructions": instructions,
            "model_name": model_name,
            "kbs": kbs,
        })
        for kb in kbs:
            if kb["document_count"]:
                tools.search_knowledge_base(kb["id"], message, top_k=2)
                break
        return "agent answer"


class FakeRetrievePipeline:
    def __init__(self):
        self.calls = []

    def retrieve(self, kb_id, query, k=None):
        self.calls.append((kb_id, query, k))
        return [
            {"text": "alpha", "score": 0.7, "doc_id": "doc-alpha", "db_doc_id": ""},
            {"text": "beta", "score": 0.6, "doc_id": "doc-beta", "db_doc_id": ""},
        ]


def make_client(tmp_path, runner=None):
    db = DB(str(tmp_path / "test.db"))
    pipeline = Pipeline(db=db, embedder=MockEmbedder(), llm=MockLLMCaller(),
                        chroma_path=str(tmp_path / "chroma"), top_k=5,
                        default_system_prompt=get_effective_settings(db)["system_prompt"])
    engine = AgenticRagEngine(db=db, pipeline=pipeline, runner=runner)

    def _get_test_db():
        return db

    def _get_test_pipeline():
        return pipeline

    def _get_test_agentic_engine():
        return engine

    app = create_app(lifespan=None)
    app.dependency_overrides[get_db] = _get_test_db
    app.dependency_overrides[get_pipeline] = _get_test_pipeline
    app.dependency_overrides[get_agentic_engine] = _get_test_agentic_engine
    return TestClient(app), db, pipeline, engine


def test_source_collector_deduplicates_and_keeps_best_score():
    collector = SourceCollector(max_sources=2)
    collector.add_chunk("kb1", {"text": "same", "score": 0.2, "doc_id": "d", "db_doc_id": "db"})
    collector.add_chunk("kb1", {"text": "same", "score": 0.9, "doc_id": "d", "db_doc_id": "db"})
    collector.add_chunk("kb2", {"text": "other", "score": 0.5, "doc_id": "d2", "db_doc_id": "db2"})
    collector.add_chunk("kb3", {"text": "low", "score": 0.1, "doc_id": "d3", "db_doc_id": "db3"})

    sources = collector.list_sources()

    assert len(sources) == 2
    assert sources[0]["text"] == "same"
    assert sources[0]["score"] == 0.9
    assert collector.used_kbs() == ["kb1", "kb2"]


def test_agent_tools_list_and_search_only_allowed_kbs(tmp_path):
    db = DB(str(tmp_path / "test.db"))
    kb_allowed = db.create_kb("Allowed KB", "allowed desc")
    kb_denied = db.create_kb("Denied KB", "denied desc")
    doc = db.create_doc(kb_allowed["id"], "note.md", "note.md", 1)
    pipeline = MagicMock()
    pipeline.retrieve.return_value = [
        {"text": "retrieved text", "score": 0.8, "doc_id": "note_md", "db_doc_id": doc["id"]}
    ]
    collector = SourceCollector()
    tools = AgentKnowledgeTools(db, pipeline, [kb_allowed["id"]], collector)

    kbs = tools.list_knowledge_bases()
    results = tools.search_knowledge_base(kb_allowed["id"], "query", top_k=99)

    assert [kb["id"] for kb in kbs] == [kb_allowed["id"]]
    assert kbs[0]["document_count"] == 1
    assert results[0]["filename"] == "note.md"
    assert collector.list_sources()[0]["kb_id"] == kb_allowed["id"]
    pipeline.retrieve.assert_called_once_with(kb_allowed["id"], "query", k=8)

    try:
        tools.search_knowledge_base(kb_denied["id"], "query")
    except KnowledgeBaseAccessError:
        pass
    else:
        raise AssertionError("expected KnowledgeBaseAccessError")


def test_openai_agents_runner_imports_sdk_and_returns_final_output(monkeypatch):
    import agents

    class FakeTools:
        def list_knowledge_bases(self):
            return []

        def search_knowledge_base(self, kb_id: str, query: str, top_k: int = 5):
            return []

    async def fake_run(agent, message):
        class Result:
            final_output = "sdk answer"

        return Result()

    monkeypatch.setattr(agents.Runner, "run", staticmethod(fake_run))

    runner = OpenAIAgentsRunner("http://localhost/v1", "test-key")

    assert runner.run("hello", "instructions", FakeTools(), "gpt-4o-mini") == "sdk answer"


def test_agentic_chat_endpoint_uses_all_kbs_and_persists_agentic_messages(tmp_path):
    runner = FakeRunner()
    client, db, pipeline, engine = make_client(tmp_path, runner=runner)
    kb_bound = client.post("/api/knowledge-bases", json={"name": "bound", "description": "desc"}).json()
    kb_unbound = client.post("/api/knowledge-bases", json={"name": "unbound", "description": "desc"}).json()
    bot = client.post("/api/bots", json={"name": "b", "system_prompt": "", "kb_ids": [kb_bound["id"]]}).json()
    doc_file = tmp_path / "doc.md"
    doc_file.write_text("hello agentic rag", encoding="utf-8")
    pipeline.ingest(kb_unbound["id"], str(doc_file))

    response = client.post("/api/agent-chat", json={"message": "hello"})

    assert response.status_code == 200
    data = response.json()
    assert data["answer"] == "agent answer"
    assert data["session_id"]
    assert [kb["id"] for kb in runner.calls[0]["kbs"]] == [kb_bound["id"], kb_unbound["id"]]
    assert runner.calls[0]["message"] == "hello"
    assert "independent agentic RAG assistant" in runner.calls[0]["instructions"]

    sessions = client.get("/api/agent-sessions").json()
    assert sessions[0]["id"] == data["session_id"]
    assert sessions[0]["session_type"] == "agentic"
    assert sessions[0]["bot_id"] is None
    assert client.get(f"/api/bots/{bot['id']}/sessions").json() == []

    messages = client.get(f"/api/agent-sessions/{data['session_id']}/messages").json()
    assert [m["role"] for m in messages] == ["user", "assistant"]
    assert messages[1]["content"] == "agent answer"
    assert messages[1]["sources"][0]["kb_id"] == kb_unbound["id"]

    assert client.get(f"/api/sessions/{data['session_id']}/messages").status_code == 404
    assert client.post(f"/api/chat/{bot['id']}", json={"message": "hello classic"}).status_code == 200


def test_agentic_session_crud_and_reuse(tmp_path):
    runner = FakeRunner()
    client, db, pipeline, engine = make_client(tmp_path, runner=runner)
    client.post("/api/knowledge-bases", json={"name": "kb", "description": ""})

    first = client.post("/api/agent-chat", json={"message": "first"}).json()
    sid = first["session_id"]
    second = client.post("/api/agent-chat", json={"message": "second", "session_id": sid}).json()
    other = client.post("/api/agent-chat", json={"message": "fresh session"}).json()

    assert second["session_id"] == sid
    assert runner.calls[0]["message"] == "first"
    assert "用户：first" in runner.calls[1]["message"]
    assert "助手：agent answer" in runner.calls[1]["message"]
    assert runner.calls[1]["message"].endswith("当前用户问题：second")
    assert runner.calls[2]["message"] == "fresh session"
    assert other["session_id"] != sid

    messages = client.get(f"/api/agent-sessions/{sid}/messages").json()
    assert [m["role"] for m in messages] == ["user", "assistant", "user", "assistant"]

    renamed = client.patch(f"/api/agent-sessions/{sid}", json={"title": "Agent 会话"})
    assert renamed.status_code == 200
    assert renamed.json()["title"] == "Agent 会话"

    deleted = client.delete(f"/api/agent-sessions/{sid}")
    assert deleted.status_code == 204
    assert client.get(f"/api/agent-sessions/{sid}/messages").status_code == 404


def test_old_bot_scoped_agentic_endpoint_removed(tmp_path):
    client, db, pipeline, engine = make_client(tmp_path, runner=FakeRunner())
    kb = client.post("/api/knowledge-bases", json={"name": "kb", "description": ""}).json()
    bot = client.post("/api/bots", json={"name": "b", "system_prompt": "", "kb_ids": [kb["id"]]}).json()

    response = client.post(f"/api/bots/{bot['id']}/agent-chat", json={"message": "hello"})

    assert response.status_code in (404, 405)
