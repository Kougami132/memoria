from __future__ import annotations

import html
import logging
import re
import urllib.parse
from dataclasses import asdict, dataclass
from typing import Any

import httpx

logger = logging.getLogger("memoria.agents.web_search")

DEFAULT_TIMEOUT = 10.0
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"


@dataclass
class WebSearchItem:
    title: str
    url: str
    snippet: str


@dataclass
class WebSearchResult:
    query: str
    provider: str
    results: list[dict[str, str]]
    error: str | None = None
    success: bool = True

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _clean_html_snippet(text: str) -> str:
    cleaned = re.sub(r"<[^<]+?>", "", text)
    cleaned = html.unescape(cleaned)
    return " ".join(cleaned.split())


def _extract_target_url(raw_url: str) -> str:
    if raw_url.startswith("//"):
        raw_url = "https:" + raw_url
    if "duckduckgo.com/l/?" in raw_url:
        parsed = urllib.parse.urlparse(raw_url)
        qs = urllib.parse.parse_qs(parsed.query)
        if "uddg" in qs and qs["uddg"]:
            return qs["uddg"][0]
    return raw_url


def search_duckduckgo(
    query: str,
    max_results: int = 5,
    timeout: float = DEFAULT_TIMEOUT,
) -> WebSearchResult:
    """Search DuckDuckGo via HTML endpoint without requiring third-party API keys."""
    if not query.strip():
        return WebSearchResult(
            query=query,
            provider="duckduckgo",
            results=[],
            error="Query string cannot be empty",
            success=False,
        )

    url = "https://html.duckduckgo.com/html/"
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
    }
    data = {"q": query}

    try:
        with httpx.Client(timeout=timeout, follow_redirects=True) as client:
            resp = client.post(url, data=data, headers=headers)
            if resp.status_code != 200:
                return WebSearchResult(
                    query=query,
                    provider="duckduckgo",
                    results=[],
                    error=f"DuckDuckGo returned HTTP {resp.status_code}",
                    success=False,
                )

            body_text = resp.text
            # Find result links and snippets
            # Pattern matches each result block:
            # <a class="result__snippet" ...>...</a>
            # <a class="result__url" ...>...</a>
            # or matches result__a (titles) and result__snippet (snippets)
            results: list[dict[str, str]] = []

            # Match title link: <a class="result__a" href="...">title</a>
            title_pattern = re.compile(r'<a[^>]+class=[\'"][^\'"]*result__a[^\'"]*[\'"][^>]*href=[\'"]([^\'"]+)[\'"][^>]*>(.*?)</a>', re.DOTALL)
            snippet_pattern = re.compile(r'<a[^>]+class=[\'"][^\'"]*result__snippet[^\'"]*[\'"][^>]*>(.*?)</a>', re.DOTALL)

            titles_and_urls = title_pattern.findall(body_text)
            snippets = snippet_pattern.findall(body_text)

            for idx, (raw_href, raw_title) in enumerate(titles_and_urls):
                if len(results) >= max_results:
                    break
                clean_title = _clean_html_snippet(raw_title)
                clean_url = _extract_target_url(raw_href)
                snippet = ""
                if idx < len(snippets):
                    snippet = _clean_html_snippet(snippets[idx])

                results.append({
                    "title": clean_title,
                    "url": clean_url,
                    "snippet": snippet,
                })

            return WebSearchResult(
                query=query,
                provider="duckduckgo",
                results=results,
                error=None,
                success=True,
            )

    except Exception as exc:
        logger.warning("DuckDuckGo search error: %s", exc)
        return WebSearchResult(
            query=query,
            provider="duckduckgo",
            results=[],
            error=str(exc),
            success=False,
        )


def search_bing_api(
    query: str,
    api_key: str,
    endpoint: str = "https://api.bing.microsoft.com/v7.0/search",
    max_results: int = 5,
    timeout: float = DEFAULT_TIMEOUT,
) -> WebSearchResult:
    """Search Bing Web Search API using subscription key."""
    if not query.strip():
        return WebSearchResult(
            query=query,
            provider="bing",
            results=[],
            error="Query string cannot be empty",
            success=False,
        )
    if not api_key.strip():
        return WebSearchResult(
            query=query,
            provider="bing",
            results=[],
            error="Bing API key is not configured",
            success=False,
        )

    headers = {"Ocp-Apim-Subscription-Key": api_key.strip()}
    params = {"q": query, "count": max_results}

    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.get(endpoint, headers=headers, params=params)
            if resp.status_code != 200:
                return WebSearchResult(
                    query=query,
                    provider="bing",
                    results=[],
                    error=f"Bing API returned HTTP {resp.status_code}: {resp.text[:200]}",
                    success=False,
                )
            data = resp.json()
            web_pages = data.get("webPages", {}).get("value", [])
            results = [
                {
                    "title": p.get("name", ""),
                    "url": p.get("url", ""),
                    "snippet": p.get("snippet", ""),
                }
                for p in web_pages[:max_results]
            ]
            return WebSearchResult(
                query=query,
                provider="bing",
                results=results,
                error=None,
                success=True,
            )
    except Exception as exc:
        logger.warning("Bing API search error: %s", exc)
        return WebSearchResult(
            query=query,
            provider="bing",
            results=[],
            error=str(exc),
            success=False,
        )


def search_google_serp(
    query: str,
    api_key: str,
    endpoint: str = "https://serpapi.com/search",
    max_results: int = 5,
    timeout: float = DEFAULT_TIMEOUT,
) -> WebSearchResult:
    """Search via SerpApi / Google search provider using API key."""
    if not query.strip():
        return WebSearchResult(
            query=query,
            provider="google_serp",
            results=[],
            error="Query string cannot be empty",
            success=False,
        )
    if not api_key.strip():
        return WebSearchResult(
            query=query,
            provider="google_serp",
            results=[],
            error="SerpApi / Google API key is not configured",
            success=False,
        )

    params = {
        "q": query,
        "api_key": api_key.strip(),
        "engine": "google",
        "num": max_results,
    }

    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.get(endpoint, params=params)
            if resp.status_code != 200:
                return WebSearchResult(
                    query=query,
                    provider="google_serp",
                    results=[],
                    error=f"SerpApi returned HTTP {resp.status_code}: {resp.text[:200]}",
                    success=False,
                )
            data = resp.json()
            organic = data.get("organic_results", [])
            results = [
                {
                    "title": item.get("title", ""),
                    "url": item.get("link", ""),
                    "snippet": item.get("snippet", ""),
                }
                for item in organic[:max_results]
            ]
            return WebSearchResult(
                query=query,
                provider="google_serp",
                results=results,
                error=None,
                success=True,
            )
    except Exception as exc:
        logger.warning("SerpApi search error: %s", exc)
        return WebSearchResult(
            query=query,
            provider="google_serp",
            results=[],
            error=str(exc),
            success=False,
        )



def search_searxng(
    query: str,
    endpoint: str,
    max_results: int = 5,
    timeout: float = DEFAULT_TIMEOUT,
) -> WebSearchResult:
    if not query.strip():
        return WebSearchResult(query=query, provider="searxng", results=[], error="Query string cannot be empty", success=False)
    if not endpoint.strip():
        return WebSearchResult(query=query, provider="searxng", results=[], error="SearXNG endpoint is not configured", success=False)
    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.get(endpoint, params={"q": query, "format": "json"})
            if resp.status_code != 200:
                return WebSearchResult(query=query, provider="searxng", results=[], error=f"SearXNG returned HTTP {resp.status_code}", success=False)
            data = resp.json()
            items = data.get("results", [])
            results = [
                {"title": item.get("title", ""), "url": item.get("url", ""), "snippet": item.get("content", "")}
                for item in items[:max_results]
            ]
            return WebSearchResult(query=query, provider="searxng", results=results, error=None, success=True)
    except Exception as exc:
        return WebSearchResult(query=query, provider="searxng", results=[], error=str(exc), success=False)


def search_tavily(
    query: str,
    api_key: str,
    endpoint: str = "https://api.tavily.com/search",
    max_results: int = 5,
    timeout: float = DEFAULT_TIMEOUT,
) -> WebSearchResult:
    if not query.strip():
        return WebSearchResult(query=query, provider="tavily", results=[], error="Query string cannot be empty", success=False)
    if not api_key.strip():
        return WebSearchResult(query=query, provider="tavily", results=[], error="Tavily API key is not configured", success=False)
    try:
        ep = endpoint.strip() or "https://api.tavily.com/search"
        with httpx.Client(timeout=timeout) as client:
            resp = client.post(ep, json={"query": query, "api_key": api_key.strip(), "max_results": max_results})
            if resp.status_code != 200:
                return WebSearchResult(query=query, provider="tavily", results=[], error=f"Tavily returned HTTP {resp.status_code}", success=False)
            data = resp.json()
            items = data.get("results", [])
            results = [
                {"title": item.get("title", ""), "url": item.get("url", ""), "snippet": item.get("content", "")}
                for item in items[:max_results]
            ]
            return WebSearchResult(query=query, provider="tavily", results=results, error=None, success=True)
    except Exception as exc:
        return WebSearchResult(query=query, provider="tavily", results=[], error=str(exc), success=False)


def execute_web_search(
    query: str,
    provider: str = "duckduckgo",
    api_key: str = "",
    endpoint: str = "",
    max_results: int = 5,
    timeout: float = DEFAULT_TIMEOUT,
) -> WebSearchResult:
    """Unified entry point for web search routing across supported providers."""
    prov = (provider or "duckduckgo").strip().lower()

    if prov == "duckduckgo":
        return search_duckduckgo(query, max_results=max_results, timeout=timeout)
    elif prov == "bing":
        ep = endpoint.strip() or "https://api.bing.microsoft.com/v7.0/search"
        return search_bing_api(query, api_key=api_key, endpoint=ep, max_results=max_results, timeout=timeout)
    elif prov in ("google_serp", "google", "serpapi"):
        ep = endpoint.strip() or "https://serpapi.com/search"
        return search_google_serp(query, api_key=api_key, endpoint=ep, max_results=max_results, timeout=timeout)
    elif prov == "searxng":
        return search_searxng(query, endpoint=endpoint, max_results=max_results, timeout=timeout)
    elif prov == "tavily":
        return search_tavily(query, api_key=api_key, endpoint=endpoint, max_results=max_results, timeout=timeout)
    else:
        # Fallback to duckduckgo if unknown provider
        logger.info("Unknown provider %s, falling back to duckduckgo", prov)
        return search_duckduckgo(query, max_results=max_results, timeout=timeout)
