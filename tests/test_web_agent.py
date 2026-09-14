import pytest
from unittest.mock import MagicMock, patch
from memoria.agents.web_search import execute_web_search, WebSearchResult
from memoria.agents.tools import AgentWebTools, AgentTools
from memoria.agents.temporal import get_current_temporal_context
from memoria.agents.state import SourceCollector
from memoria.storage.db import DB
from memoria.core.pipeline import Pipeline
from memoria.core.embedder import MockEmbedder


def test_temporal_context():
    ctx = get_current_temporal_context("Asia/Shanghai")
    assert "formatted" in ctx
    assert "iso" in ctx
    assert ctx["timezone"] == "Asia/Shanghai"
    assert "202" in ctx["formatted"]


def test_web_search_duckduckgo_parsing(monkeypatch):
    mock_html = """
    <div class="result__body">
        <a class="result__url" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage1&rut=xyz"></a>
        <h2 class="result__title"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage1&rut=xyz">Example Page 1</a></h2>
        <a class="result__snippet" href="...">This is the snippet for <b>example 1</b>.</a>
    </div>
    <div class="result__body">
        <a class="result__url" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage2&rut=xyz"></a>
        <h2 class="result__title"><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage2&rut=xyz">Example Page 2</a></h2>
        <a class="result__snippet" href="...">Another snippet.</a>
    </div>
    """
    class MockResponse:
        status_code = 200
        text = mock_html

    class MockClient:
        def __init__(self, *args, **kwargs):
            pass
        def __enter__(self):
            return self
        def __exit__(self, *args):
            pass
        def get(self, *args, **kwargs):
            return MockResponse()
        def post(self, *args, **kwargs):
            return MockResponse()
        def close(self):
            pass

    monkeypatch.setattr("httpx.Client", MockClient)

    res = execute_web_search("test query", provider="duckduckgo", max_results=5)
    assert res.success is True
    assert len(res.results) == 2
    assert res.results[0]["title"] == "Example Page 1"
    assert res.results[0]["url"] == "https://example.com/page1"
    assert "snippet for example 1" in res.results[0]["snippet"]


def test_web_search_searxng_provider(monkeypatch):
    class MockResponse:
        status_code = 200
        def json(self):
            return {
                "results": [
                    {"title": "SearXNG 1", "url": "https://searx.org/1", "content": "Content 1"},
                    {"title": "SearXNG 2", "url": "https://searx.org/2", "content": "Content 2"},
                ]
            }

    class MockClient:
        def __init__(self, *args, **kwargs):
            pass
        def __enter__(self):
            return self
        def __exit__(self, *args):
            pass
        def get(self, *args, **kwargs):
            return MockResponse()
        def close(self):
            pass

    monkeypatch.setattr("httpx.Client", MockClient)

    res = execute_web_search("query", provider="searxng", endpoint="https://searxng.local/search")
    assert res.success is True
    assert len(res.results) == 2
    assert res.results[0]["title"] == "SearXNG 1"
    assert res.results[0]["url"] == "https://searx.org/1"


def test_web_search_tavily_provider(monkeypatch):
    class MockResponse:
        status_code = 200
        def json(self):
            return {
                "results": [
                    {"title": "Tavily 1", "url": "https://tavily.com/1", "content": "Tavily snippet"},
                ]
            }

    class MockClient:
        def __init__(self, *args, **kwargs):
            pass
        def __enter__(self):
            return self
        def __exit__(self, *args):
            pass
        def post(self, *args, **kwargs):
            return MockResponse()
        def close(self):
            pass

    monkeypatch.setattr("httpx.Client", MockClient)

    res = execute_web_search("query", provider="tavily", api_key="tvly-xxx")
    assert res.success is True
    assert len(res.results) == 1
    assert res.results[0]["title"] == "Tavily 1"


def test_agent_web_tools_integration(tmp_path, monkeypatch):
    collector = SourceCollector()
    tools = AgentWebTools(collector=collector)

    mock_res = WebSearchResult(
        success=True,
        query="test query",
        provider="duckduckgo",
        results=[
            {"title": "Integration Test", "url": "https://example.com/res", "snippet": "Test snippet"}
        ]
    )
    monkeypatch.setattr("memoria.agents.web_search.execute_web_search", lambda *args, **kwargs: mock_res)

    res = tools.web_search("test query", max_results=3)
    assert res["success"] is True
    assert len(res["results"]) == 1

    # Check collector recorded external source
    sources = collector.list_sources()
    assert len(sources) == 1
    assert sources[0]["type"] == "web"
    assert sources[0]["url"] == "https://example.com/res"
    assert sources[0]["title"] == "Integration Test"
