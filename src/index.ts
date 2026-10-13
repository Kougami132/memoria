import { existsSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { serve } from "@hono/node-server";
import { MemoriaAgentRuntime } from "./agent/runtime.ts";
import { createApp } from "./server/app.ts";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
};

export async function startServer(port = Number(process.env.PORT || 8000)) {
  const runtime = await MemoriaAgentRuntime.create();
  const app = createApp(runtime);

  const staticDir = existsSync("./web/dist/index.html")
    ? "./web/dist"
    : existsSync("./memoria/static/index.html")
      ? "./memoria/static"
      : null;

  if (staticDir) {
    app.get("*", (c) => {
      if (c.req.path.startsWith("/api/") || c.req.path.startsWith("/v1/")) {
        return c.json({ detail: "Not Found" }, 404);
      }
      const cleanPath = c.req.path === "/" ? "/index.html" : c.req.path;
      const candidate = join(staticDir, cleanPath);
      if (existsSync(candidate) && extname(candidate)) {
        const mime = MIME_TYPES[extname(candidate)] || "application/octet-stream";
        return c.body(readFileSync(candidate), 200, { "Content-Type": mime });
      }
      const indexHtml = join(staticDir, "index.html");
      if (existsSync(indexHtml)) {
        return c.body(readFileSync(indexHtml), 200, { "Content-Type": "text/html; charset=utf-8" });
      }
      return c.text("Not Found", 404);
    });
  }

  const server = serve({
    fetch: app.fetch,
    port,
  });

  console.log(`[Memoria 2.0] pi-durable TypeScript server listening on http://localhost:${port}`);
  return { runtime, app, server };
}

export function isMainModule(metaUrl: string, argv1 = process.argv[1]): boolean {
  if (!argv1) return false;
  return metaUrl === pathToFileURL(resolve(argv1)).href;
}

if (isMainModule(import.meta.url)) {
  void startServer();
}
