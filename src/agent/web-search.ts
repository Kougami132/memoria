const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export interface WebSearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchResponse {
  query: string;
  provider: string;
  results: WebSearchResultItem[];
  error?: string;
  success: boolean;
}

function cleanHtml(raw: string): string {
  return raw
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTargetUrl(rawUrl: string): string {
  let url = rawUrl;
  if (url.startsWith("//")) url = `https:${url}`;
  try {
    if (url.includes("duckduckgo.com/l/?")) {
      const parsed = new URL(url);
      const uddg = parsed.searchParams.get("uddg");
      if (uddg) return uddg;
    }
  } catch {
    // ignore URL parse error
  }
  return url;
}

export async function searchDuckDuckGo(
  query: string,
  maxResults = 5,
): Promise<WebSearchResponse> {
  if (!query.trim()) {
    return { query, provider: "duckduckgo", results: [], error: "Empty query", success: false };
  }
  try {
    const body = new URLSearchParams({ q: query }).toString();
    const resp = await fetch("https://html.duckduckgo.com/html/", {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "text/html",
      },
      body,
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) {
      return {
        query,
        provider: "duckduckgo",
        results: [],
        error: `DuckDuckGo HTTP ${resp.status}`,
        success: false,
      };
    }
    const html = await resp.text();
    const titleRegex =
      /<a[^>]+class=['"][^'"]*result__a[^'"]*['"][^>]*href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/gi;
    const snippetRegex =
      /<a[^>]+class=['"][^'"]*result__snippet[^'"]*['"][^>]*>([\s\S]*?)<\/a>/gi;

    const titles: Array<{ href: string; title: string }> = [];
    let m: RegExpExecArray | null;
    while ((m = titleRegex.exec(html)) !== null) {
      titles.push({ href: extractTargetUrl(m[1]), title: cleanHtml(m[2]) });
    }
    const snippets: string[] = [];
    while ((m = snippetRegex.exec(html)) !== null) {
      snippets.push(cleanHtml(m[1]));
    }

    const results: WebSearchResultItem[] = titles.slice(0, maxResults).map((t, i) => ({
      title: t.title,
      url: t.href,
      snippet: snippets[i] ?? "",
    }));

    return { query, provider: "duckduckgo", results, success: true };
  } catch (err: any) {
    return {
      query,
      provider: "duckduckgo",
      results: [],
      error: err?.message || "DuckDuckGo request failed",
      success: false,
    };
  }
}

export async function searchTavily(
  query: string,
  apiKey: string,
  endpoint = "https://api.tavily.com/search",
  maxResults = 5,
): Promise<WebSearchResponse> {
  if (!apiKey.trim()) {
    return {
      query,
      provider: "tavily",
      results: [],
      error: "Tavily API key is not configured",
      success: false,
    };
  }
  try {
    const resp = await fetch(endpoint || "https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        max_results: maxResults,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) {
      return {
        query,
        provider: "tavily",
        results: [],
        error: `Tavily HTTP ${resp.status}`,
        success: false,
      };
    }
    const data = (await resp.json()) as {
      results?: Array<{ title?: string; url?: string; content?: string }>;
    };
    const results: WebSearchResultItem[] = (data.results ?? []).slice(0, maxResults).map((r) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: r.content ?? "",
    }));
    return { query, provider: "tavily", results, success: true };
  } catch (err: any) {
    return {
      query,
      provider: "tavily",
      results: [],
      error: err?.message || "Tavily search failed",
      success: false,
    };
  }
}

export async function searchSearxng(
  query: string,
  endpoint: string,
  maxResults = 5,
): Promise<WebSearchResponse> {
  if (!endpoint.trim()) {
    return {
      query,
      provider: "searxng",
      results: [],
      error: "SearXNG endpoint is not configured",
      success: false,
    };
  }
  try {
    const base = endpoint.replace(/\/+$/, "");
    const searchUrl = `${base.endsWith("/search") ? base : `${base}/search`}?q=${encodeURIComponent(query)}&format=json`;
    const resp = await fetch(searchUrl, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) {
      return {
        query,
        provider: "searxng",
        results: [],
        error: `SearXNG HTTP ${resp.status}`,
        success: false,
      };
    }
    const data = (await resp.json()) as {
      results?: Array<{ title?: string; url?: string; content?: string }>;
    };
    const results: WebSearchResultItem[] = (data.results ?? []).slice(0, maxResults).map((r) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      snippet: r.content ?? "",
    }));
    return { query, provider: "searxng", results, success: true };
  } catch (err: any) {
    return {
      query,
      provider: "searxng",
      results: [],
      error: err?.message || "SearXNG search failed",
      success: false,
    };
  }
}

export async function executeWebSearch(params: {
  query: string;
  provider?: string;
  apiKey?: string;
  endpoint?: string;
  maxResults?: number;
}): Promise<WebSearchResponse> {
  const provider = (params.provider || "duckduckgo").toLowerCase();
  const maxResults = params.maxResults ?? 5;
  if (provider === "tavily") {
    return searchTavily(
      params.query,
      params.apiKey ?? "",
      params.endpoint || "https://api.tavily.com/search",
      maxResults,
    );
  }
  if (provider === "searxng") {
    return searchSearxng(params.query, params.endpoint ?? "", maxResults);
  }
  return searchDuckDuckGo(params.query, maxResults);
}

export async function fetchWebPage(url: string, maxChars = 6000): Promise<string> {
  const resp = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "text/html,text/plain,*/*" },
    signal: AbortSignal.timeout(12000),
  });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status} fetching ${url}`);
  }
  const raw = await resp.text();
  const cleaned = cleanHtml(raw);
  return cleaned.slice(0, maxChars);
}
