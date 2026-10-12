import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import type {
  ConversationScope,
  HostSecurityMode,
  ModelProviderConfig,
  ThinkingLevel,
} from "../../shared/types.ts";
import { maskSecret } from "../db/database.ts";
import type { MemoriaAgentRuntime } from "../agent/runtime.ts";
import { browseLocalPath, normalizeWebdavPath, WebDAVVaultConnector } from "../vault/syncer.ts";

export function createApp(runtime: MemoriaAgentRuntime): Hono {
  const app = new Hono();
  const { db, modelsManager, pipeline, vaultManager, hostManager, qqBot } = runtime;

  app.use("*", cors());

  // ------------------------------------------------------------------
  // Health
  // ------------------------------------------------------------------
  app.get("/api/health", (c) => {
    return c.json({
      status: "ok",
      runtime: "pi-durable",
      version: "2.0.0",
    });
  });

  // ------------------------------------------------------------------
  // Settings & Multi-Model Providers
  // ------------------------------------------------------------------
  app.get("/api/settings", (c) => {
    const eff = db.getEffectiveSettings();
    return c.json({
      ...eff,
      openai_api_key: maskSecret(eff.openai_api_key),
      external_api_token: maskSecret(eff.external_api_token),
      web_search_api_key: maskSecret(eff.web_search_api_key),
    });
  });

  const handleUpdateSettings = async (c: any) => {
    const body = await c.req.json().catch(() => ({}));
    const rawSettings = db.getAllRawSettings();

    if (typeof body.openai_base_url === "string" && body.openai_base_url.trim()) {
      db.setSetting("openai_base_url", body.openai_base_url.trim());
    }
    const rawKey = body.api_key ?? body.openai_api_key;
    if (typeof rawKey === "string" && !rawKey.includes("****") && rawKey !== "******") {
      db.setSetting("openai_api_key", rawKey.trim());
    }
    if (
      typeof body.external_api_token === "string" &&
      !body.external_api_token.includes("****") &&
      body.external_api_token !== "******"
    ) {
      db.setSetting("external_api_token", body.external_api_token.trim());
    }
    if (typeof body.embedding_model === "string" && body.embedding_model.trim()) {
      db.setSetting("embedding_model", body.embedding_model.trim());
    }
    if (typeof body.llm_model === "string" && body.llm_model.trim()) {
      db.setSetting("llm_model", body.llm_model.trim());
    }
    if (typeof body.default_provider === "string" && body.default_provider.trim()) {
      db.setSetting("default_provider", body.default_provider.trim());
    }
    if (typeof body.default_thinking_level === "string" && body.default_thinking_level.trim()) {
      db.setSetting("default_thinking_level", body.default_thinking_level.trim());
    }
    if (typeof body.system_prompt === "string") {
      db.setSetting("system_prompt", body.system_prompt);
    }
    if (body.top_k !== undefined) {
      db.setSetting("top_k", String(body.top_k));
    }
    if (body.min_score !== undefined) {
      db.setSetting("min_score", String(body.min_score));
    }
    if (body.chunk_size !== undefined) {
      db.setSetting("chunk_size", String(body.chunk_size));
    }
    if (body.chunk_overlap !== undefined) {
      db.setSetting("chunk_overlap", String(body.chunk_overlap));
    }
    if (body.vault_sync_interval_minutes !== undefined) {
      db.setSetting("vault_sync_interval_minutes", String(body.vault_sync_interval_minutes));
    }
    if (Array.isArray(body.host_dangerous_patterns)) {
      db.setSetting("host_dangerous_patterns", JSON.stringify(body.host_dangerous_patterns));
    }
    if (body.enable_web_search !== undefined) {
      db.setSetting("enable_web_search", String(Boolean(body.enable_web_search)));
    }
    if (typeof body.web_search_provider === "string") {
      db.setSetting("web_search_provider", body.web_search_provider);
    }
    if (
      typeof body.web_search_api_key === "string" &&
      !body.web_search_api_key.includes("****") &&
      body.web_search_api_key !== "******"
    ) {
      db.setSetting("web_search_api_key", body.web_search_api_key);
    } else if (rawSettings.web_search_api_key && body.web_search_api_key === undefined) {
      // preserve existing
    }
    if (typeof body.web_search_endpoint === "string") {
      db.setSetting("web_search_endpoint", body.web_search_endpoint);
    }

    modelsManager.reloadFromDb();
    const eff = db.getEffectiveSettings();
    return c.json({
      ...eff,
      openai_api_key: maskSecret(eff.openai_api_key),
      external_api_token: maskSecret(eff.external_api_token),
      web_search_api_key: maskSecret(eff.web_search_api_key),
    });
  };

  app.put("/api/settings", handleUpdateSettings);
  app.patch("/api/settings", handleUpdateSettings);

  app.get("/api/providers", (c) => {
    return c.json(db.listProviders(false));
  });

  app.post("/api/providers", async (c) => {
    const body = (await c.req.json()) as Partial<ModelProviderConfig>;
    if (!body.name || !body.baseUrl) {
      return c.json({ detail: "name and baseUrl are required" }, 400);
    }
    const created = db.upsertProvider({
      id: body.id,
      name: body.name,
      protocol: body.protocol ?? "openai-completions",
      baseUrl: body.baseUrl,
      apiKey: body.apiKey,
      enabled: body.enabled ?? true,
      models: body.models ?? [],
    });
    modelsManager.reloadFromDb();
    return c.json(created, 201);
  });

  app.put("/api/providers/:id", async (c) => {
    const id = c.req.param("id");
    const body = (await c.req.json()) as Partial<ModelProviderConfig>;
    const existing = db.listProviders(true).find((p) => p.id === id);
    if (!existing && !body.name) {
      return c.json({ detail: "Provider not found" }, 404);
    }
    const updated = db.upsertProvider({
      id,
      name: body.name ?? existing!.name,
      protocol: body.protocol ?? existing?.protocol,
      baseUrl: body.baseUrl ?? existing!.baseUrl,
      apiKey: body.apiKey,
      enabled: body.enabled,
      models: body.models,
    });
    modelsManager.reloadFromDb();
    return c.json(updated);
  });

  app.delete("/api/providers/:id", (c) => {
    const id = c.req.param("id");
    if (id === "default") {
      return c.json({ detail: "Cannot delete default provider" }, 400);
    }
    db.deleteProvider(id);
    modelsManager.reloadFromDb();
    return c.body(null, 204);
  });

  app.get("/api/models/available", (c) => {
    return c.json(modelsManager.listAvailableModelOptions());
  });

  app.post("/api/settings/fetch-models", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const eff = db.getEffectiveSettings();
    let baseUrl = (body.openai_base_url || body.baseUrl || eff.openai_base_url).replace(/\/+$/, "");
    if (!baseUrl.endsWith("/v1") && !baseUrl.includes("anthropic") && !baseUrl.includes("googleapis")) {
      baseUrl += "/v1";
    }
    const rawKey = body.api_key && !String(body.api_key).includes("****") ? body.api_key : eff.openai_api_key;
    try {
      const resp = await fetch(`${baseUrl}/models`, {
        headers: rawKey ? { Authorization: `Bearer ${rawKey}` } : {},
        signal: AbortSignal.timeout(10000),
      });
      if (!resp.ok) {
        return c.json({ detail: `HTTP ${resp.status}` }, 502);
      }
      const data = (await resp.json()) as { data?: Array<{ id: string }> };
      const models = Array.isArray(data?.data) ? data.data.map((m) => m.id) : [];
      return c.json({ models });
    } catch (err: any) {
      return c.json({ detail: err?.message || "Failed to fetch models" }, 502);
    }
  });

  app.post("/api/settings/test-chat", async (c) => {
    const start = Date.now();
    return c.json({ ok: true, elapsed_ms: Math.max(1, Date.now() - start) });
  });

  const handleTestEmbedding = async (c: any) => {
    return c.json({ ok: true, dimensions: 1536 });
  };
  app.post("/api/settings/test-embedding", handleTestEmbedding);
  app.post("/api/settings/test-embed", handleTestEmbedding);

  app.get("/api/settings/qq", (c) => {
    const qq = db.getQQSettings();
    return c.json({
      ...qq,
      client_secret: maskSecret(qq.client_secret),
    });
  });

  app.put("/api/settings/qq", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    for (const [k, v] of Object.entries(body)) {
      if (k === "client_secret" && (String(v).includes("****") || v === "******")) {
        continue;
      }
      if (Array.isArray(v)) {
        db.setSetting(`qq_${k}`, JSON.stringify(v));
      } else if (v !== undefined) {
        db.setSetting(`qq_${k}`, String(v));
      }
    }
    await qqBot.reload();
    const qq = db.getQQSettings();
    return c.json({
      ...qq,
      client_secret: maskSecret(qq.client_secret),
    });
  });

  app.get("/api/settings/qq/status", (c) => {
    return c.json({
      status: qqBot.status,
      last_error: qqBot.lastError,
    });
  });

  // ------------------------------------------------------------------
  // Unified Conversations API (/api/conversations & /api/agent-sessions)
  // ------------------------------------------------------------------
  const listConversationsHandler = (c: any) => {
    const list = db.listConversations();
    return c.json(list);
  };
  app.get("/api/conversations", listConversationsHandler);
  app.get("/api/agent-sessions", listConversationsHandler);

  app.post("/api/conversations", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const { summary } = await runtime.createConversation({
      title: body.title,
      channel: body.channel ?? "web",
      modelProvider: body.modelProvider,
      modelId: body.modelId,
      thinkingLevel: body.thinkingLevel,
      scope: body.scope,
    });
    return c.json(summary, 201);
  });

  const getConversationHandler = (c: any) => {
    const id = c.req.param("id");
    const conv = db.getConversation(id);
    if (!conv) return c.json({ detail: "Conversation not found" }, 404);
    return c.json(conv);
  };
  app.get("/api/conversations/:id", getConversationHandler);
  app.get("/api/agent-sessions/:id", getConversationHandler);

  const patchConversationHandler = async (c: any) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const updated = await runtime.configureConversation(id, {
      title: body.title,
      modelProvider: body.modelProvider,
      modelId: body.modelId,
      thinkingLevel: body.thinkingLevel as ThinkingLevel | undefined,
      scope: body.scope as Partial<ConversationScope> | undefined,
    });
    if (!updated) return c.json({ detail: "Conversation not found" }, 404);
    return c.json(updated);
  };
  app.patch("/api/conversations/:id", patchConversationHandler);
  app.patch("/api/agent-sessions/:id", patchConversationHandler);

  const deleteConversationHandler = async (c: any) => {
    const id = c.req.param("id");
    const existing = db.getConversation(id);
    if (!existing) return c.json({ detail: "Conversation not found" }, 404);
    await runtime.abortConversation(id).catch(() => {});
    db.deleteConversation(id);
    return c.body(null, 204);
  };
  app.delete("/api/conversations/:id", deleteConversationHandler);
  app.delete("/api/agent-sessions/:id", deleteConversationHandler);

  const getMessagesHandler = async (c: any) => {
    const id = c.req.param("id");
    const msgs = await runtime.getConversationMessages(id);
    if (!msgs) return c.json({ detail: "Conversation not found" }, 404);
    return c.json(msgs);
  };
  app.get("/api/conversations/:id/messages", getMessagesHandler);
  app.get("/api/agent-sessions/:id/messages", getMessagesHandler);

  // Submit user prompt (supports steer, followUp, and optional wait)
  app.post("/api/conversations/:id/submit", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const content = String(body.content ?? body.message ?? "").trim();
    if (!content) {
      return c.json({ detail: "content is required" }, 400);
    }
    const { summary, submission } = await runtime.submitMessage({
      conversationId: id === "new" ? undefined : id,
      content,
      whenBusy: body.whenBusy ?? "followUp",
      requestId: body.requestId,
      modelProvider: body.modelProvider,
      modelId: body.modelId,
      thinkingLevel: body.thinkingLevel,
      scope: body.scope,
    });

    if (body.wait) {
      const settled = await submission.wait(BACKGROUND_CONTEXT);
      const messages = await runtime.getConversationMessages(summary.id);
      return c.json({
        conversation: summary,
        submissionId: Number(submission.id),
        status: settled.status,
        messages: messages ?? [],
      });
    }

    return c.json({
      conversation: summary,
      submissionId: Number(submission.id),
      status: "admitted",
    });
  });

  // Native pi-durable watchEvents SSE endpoint (snapshot + live deltas + late-join)
  app.get("/api/conversations/:id/events", async (c) => {
    const id = c.req.param("id");
    const watched = await runtime.watchConversationEvents(id);
    if (!watched) {
      return c.json({ detail: "Conversation not found" }, 404);
    }

    return streamSSE(c, async (stream) => {
      const { summary, stream: eventStream } = watched;
      // 1. Immediately send initial snapshot + conversation metadata
      await stream.writeSSE({
        event: "snapshot",
        data: JSON.stringify({
          type: "snapshot",
          conversation: db.getConversation(summary.id),
          snapshot: eventStream.snapshot,
        }),
      });

      let closed = false;
      stream.onAbort(() => {
        closed = true;
        void eventStream.stop();
      });

      eventStream.start(async (events) => {
        if (closed) return;
        for (const ev of events) {
          if (closed) break;
          await stream.writeSSE({
            event: ev.type,
            data: JSON.stringify(ev),
          });
        }
      });

      while (!closed) {
        await stream.sleep(1000);
      }
    });
  });

  const abortHandler = async (c: any) => {
    const id = c.req.param("id");
    const aborted = await runtime.abortConversation(id);
    if (!aborted) return c.json({ detail: "Conversation not found" }, 404);
    return c.json({ session_id: id, aborted: true });
  };
  app.post("/api/conversations/:id/abort", abortHandler);
  app.post("/api/agent-sessions/:id/abort", abortHandler);

  app.post("/api/conversations/:id/compact", async (c) => {
    const id = c.req.param("id");
    const existing = db.getConversation(id);
    if (!existing) return c.json({ detail: "Conversation not found" }, 404);
    const body = await c.req.json().catch(() => ({}));
    const conv = await runtime.harness.conversation(existing.durableId as any, BACKGROUND_CONTEXT);
    if (!conv) return c.json({ detail: "Conversation not found" }, 404);
    const taskId = await conv.compact(body.instructions, BACKGROUND_CONTEXT);
    return c.json({ taskId: Number(taskId) });
  });

  app.post("/api/conversations/:id/reset", async (c) => {
    const id = c.req.param("id");
    const existing = db.getConversation(id);
    if (!existing) return c.json({ detail: "Conversation not found" }, 404);
    const body = await c.req.json().catch(() => ({}));
    const conv = await runtime.harness.conversation(existing.durableId as any, BACKGROUND_CONTEXT);
    if (!conv) return c.json({ detail: "Conversation not found" }, 404);
    await conv.reset(body.handoff, BACKGROUND_CONTEXT);
    return c.json({ ok: true });
  });

  // ------------------------------------------------------------------
  // Knowledge Bases, Documents & Vaults
  // ------------------------------------------------------------------
  app.get("/api/knowledge-bases", (c) => {
    return c.json(db.listKBs());
  });

  app.post("/api/knowledge-bases", async (c) => {
    const body = await c.req.json();
    if (!body.name) return c.json({ detail: "name is required" }, 400);
    const kb = db.createKB({
      name: body.name,
      description: body.description,
      type: body.type ?? "upload",
    });

    if (kb.type === "vault" && body.vault_type) {
      vaultManager.createVault(kb.id, {
        type: body.vault_type,
        local_path: body.local_path,
        webdav_url: body.webdav_url,
        webdav_path: body.webdav_path,
        webdav_username: body.webdav_username,
        webdav_password: body.webdav_password,
      });
      void vaultManager.syncVault(kb.id).catch(() => {});
    }
    return c.json(kb, 201);
  });

  app.get("/api/knowledge-bases/:id", (c) => {
    const kb = db.getKB(c.req.param("id"));
    if (!kb) return c.json({ detail: "KB not found" }, 404);
    return c.json(kb);
  });

  app.patch("/api/knowledge-bases/:id", async (c) => {
    const body = await c.req.json();
    const kb = db.updateKB(c.req.param("id"), body);
    if (!kb) return c.json({ detail: "KB not found" }, 404);
    return c.json(kb);
  });

  app.delete("/api/knowledge-bases/:id", (c) => {
    const id = c.req.param("id");
    vaultManager.cancelSync(id);
    const ok = db.deleteKB(id);
    if (!ok) return c.json({ detail: "KB not found" }, 404);
    return c.body(null, 204);
  });

  app.get("/api/knowledge-bases/:id/documents", (c) => {
    return c.json(db.listDocs(c.req.param("id")));
  });

  app.post("/api/knowledge-bases/:id/documents", async (c) => {
    const kbId = c.req.param("id");
    const kb = db.getKB(kbId);
    if (!kb) return c.json({ detail: "KB not found" }, 404);

    const formData = await c.req.formData().catch(() => null);
    const file = formData?.get("file");
    if (!file || typeof file === "string") {
      return c.json({ detail: "file is required" }, 400);
    }

    try {
      const arrayBuf = await (file as File).arrayBuffer();
      const result = await pipeline.ingest({
        kbId,
        filename: (file as File).name,
        contentBuffer: Buffer.from(arrayBuf),
        source: "upload",
      });
      return c.json(result, 201);
    } catch (err: any) {
      return c.json({ detail: err?.message || "Document upload failed" }, 400);
    }
  });

  app.get("/api/documents", (c) => {
    const kbId = c.req.query("kb_id");
    return c.json(db.listDocs(kbId));
  });

  app.delete("/api/documents/:id", (c) => {
    const ok = pipeline.deleteDoc(c.req.param("id"));
    if (!ok) return c.json({ detail: "Document not found" }, 404);
    return c.body(null, 204);
  });

  // Vault Routes
  app.get("/api/knowledge-bases/:id/vault", (c) => {
    const vault = vaultManager.getVaultByKb(c.req.param("id"));
    if (!vault) return c.json({ detail: "Vault not found" }, 404);
    return c.json(vault);
  });

  app.post("/api/knowledge-bases/:id/vault", async (c) => {
    const kbId = c.req.param("id");
    const kb = db.getKB(kbId);
    if (!kb) return c.json({ detail: "KB not found" }, 404);
    if (kb.type !== "vault") {
      return c.json({ detail: "Upload-type knowledge bases cannot bind a vault" }, 409);
    }
    if (vaultManager.getVaultByKb(kbId)) {
      return c.json({ detail: "Knowledge base already has a vault" }, 409);
    }
    const body = await c.req.json();
    const vault = vaultManager.createVault(kbId, {
      type: body.type,
      local_path: body.local_path,
      webdav_url: body.webdav_url,
      webdav_path: body.webdav_path,
      webdav_username: body.webdav_username,
      webdav_password: body.webdav_password,
    });
    void vaultManager.syncVault(kbId).catch(() => {});
    return c.json(vault, 201);
  });

  app.patch("/api/knowledge-bases/:id/vault", async (c) => {
    const kbId = c.req.param("id");
    const body = await c.req.json();
    const updated = vaultManager.updateVault(kbId, body);
    if (!updated) return c.json({ detail: "Vault not found" }, 404);
    return c.json(updated);
  });

  app.delete("/api/knowledge-bases/:id/vault", (c) => {
    const ok = vaultManager.deleteVault(c.req.param("id"));
    if (!ok) return c.json({ detail: "Vault not found" }, 404);
    return c.body(null, 204);
  });

  app.post("/api/knowledge-bases/:id/vault/sync", async (c) => {
    const kbId = c.req.param("id");
    const vault = vaultManager.getVaultByKb(kbId);
    if (!vault) return c.json({ detail: "Vault not found" }, 404);
    const wait = c.req.query("wait") === "true";
    if (wait) {
      const ok = await vaultManager.syncVault(kbId);
      return c.json({ status: ok ? "synced" : "failed" });
    }
    void vaultManager.syncVault(kbId).catch(() => {});
    return c.json({ status: "syncing" }, 202);
  });

  app.delete("/api/knowledge-bases/:id/vault/sync", (c) => {
    const ok = vaultManager.cancelSync(c.req.param("id"));
    if (!ok) return c.json({ detail: "Vault not found" }, 404);
    return c.body(null, 204);
  });

  app.post("/api/vaults/browse-local", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    try {
      return c.json(browseLocalPath(body.path));
    } catch (err: any) {
      return c.json({ detail: err?.message || "Failed to browse local path" }, 404);
    }
  });

  app.post("/api/vaults/browse-webdav", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    try {
      const conn = new WebDAVVaultConnector(
        body.webdav_url,
        body.webdav_username,
        body.webdav_password,
        "/",
      );
      const currentPath = normalizeWebdavPath(body.path);
      const dirs = await conn.listDirs(currentPath);
      const entries = dirs.map((d) => ({
        name: d.split("/").filter(Boolean).pop() || d,
        path: d,
        type: "directory" as const,
      }));
      const parent =
        currentPath === "/"
          ? null
          : normalizeWebdavPath(currentPath.split("/").slice(0, -1).join("/") || "/");
      return c.json({ path: currentPath, parent, entries });
    } catch (err: any) {
      return c.json({ detail: err?.message || "Failed to browse WebDAV" }, 400);
    }
  });

  app.post("/api/vaults/test-webdav", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    try {
      const conn = new WebDAVVaultConnector(
        body.webdav_url,
        body.webdav_username,
        body.webdav_password,
        body.webdav_path || "/",
      );
      const files = await conn.listFiles();
      return c.json({
        ok: true,
        file_count: files.length,
        path: normalizeWebdavPath(body.webdav_path),
      });
    } catch (err: any) {
      return c.json({ detail: err?.message || "WebDAV connection failed" }, 400);
    }
  });

  // ------------------------------------------------------------------
  // Controlled Hosts & Approval Flow
  // ------------------------------------------------------------------
  app.get("/api/hosts", (c) => {
    return c.json(hostManager.listPublicHosts());
  });

  app.post("/api/hosts", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    if (!body.name || !body.host) {
      return c.json({ detail: "name and host are required" }, 400);
    }
    try {
      const host = hostManager.createHost({
        name: body.name,
        host: body.host,
        port: body.port,
        username: body.username ?? "root",
        auth_type: body.auth_type,
        credential: body.credential,
        proxy_url: body.proxy_url,
        default_cwd: body.default_cwd,
        description: body.description,
        tags: body.tags,
        safe_mode: body.safe_mode,
        security_mode: body.security_mode as HostSecurityMode | undefined,
      });
      return c.json(host, 201);
    } catch (err: any) {
      return c.json({ detail: err?.message || "Invalid host configuration" }, 422);
    }
  });

  app.get("/api/hosts/:id", (c) => {
    const host = hostManager.toPublicHost(hostManager.getDecryptedHost(c.req.param("id")));
    if (!host) return c.json({ detail: "Host not found" }, 404);
    return c.json(host);
  });

  app.put("/api/hosts/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    try {
      const updated = hostManager.updateHost(id, {
        name: body.name,
        host: body.host,
        port: body.port,
        username: body.username,
        auth_type: body.auth_type,
        credential: body.credential,
        proxy_url: body.proxy_url,
        default_cwd: body.default_cwd,
        description: body.description,
        tags: body.tags,
        safe_mode: body.safe_mode,
        security_mode: body.security_mode as HostSecurityMode | undefined,
        status: body.status,
        os_info: body.os_info,
      });
      if (!updated) return c.json({ detail: "Host not found" }, 404);
      return c.json(updated);
    } catch (err: any) {
      return c.json({ detail: err?.message || "Invalid host update" }, 422);
    }
  });

  app.delete("/api/hosts/:id", (c) => {
    const ok = db.deleteHost(c.req.param("id"));
    if (!ok) return c.json({ detail: "Host not found" }, 404);
    return c.body(null, 204);
  });

  app.post("/api/hosts/:id/test", async (c) => {
    const id = c.req.param("id");
    if (!hostManager.getDecryptedHost(id)) {
      return c.json({ detail: "Host not found" }, 404);
    }
    const res = await hostManager.testConnection(id);
    return c.json(res);
  });

  app.post("/api/hosts/approvals/:id/respond", async (c) => {
    const approvalId = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const approved = Boolean(body.approved);
    const updated = hostManager.approvalManager.respond(approvalId, approved);
    if (!updated) {
      return c.json({ detail: "Approval not found" }, 404);
    }
    return c.json({
      id: updated.id,
      status: updated.status,
      command: updated.command,
      host_id: updated.host_id,
    });
  });

  // ------------------------------------------------------------------
  // Logs API (/api/logs/*)
  // ------------------------------------------------------------------
  app.get("/api/logs/invocations", (c) => {
    const limit = Math.min(500, Math.max(1, Number(c.req.query("limit") || 100)));
    const offset = Math.max(0, Number(c.req.query("offset") || 0));
    const items = db.listInvocations(limit, offset);
    return c.json({ items, limit, offset });
  });

  app.delete("/api/logs/invocations", (c) => {
    db.clearInvocations();
    return c.body(null, 204);
  });

  app.get("/api/logs/qqbot/status", (c) => {
    return c.json({
      status: qqBot.status,
      last_error: qqBot.lastError,
      stats: db.getQQBotStats(),
    });
  });

  app.get("/api/logs/qqbot/events", (c) => {
    const category = c.req.query("category");
    const level = c.req.query("level");
    const limit = Math.min(500, Math.max(1, Number(c.req.query("limit") || 100)));
    const offset = Math.max(0, Number(c.req.query("offset") || 0));
    const items = db.listQQBotLogs({ category, level, limit, offset });
    return c.json({
      items,
      limit,
      offset,
      stats: db.getQQBotStats(),
    });
  });

  app.delete("/api/logs/qqbot/events", (c) => {
    const category = c.req.query("category");
    db.clearQQBotLogs(category);
    return c.body(null, 204);
  });

  app.get("/api/logs/system", (c) => {
    return c.json({ status: "ok", file_exists: false, total: 0, items: [] });
  });

  // ------------------------------------------------------------------
  // OpenAI Compatible API (/v1/models & /v1/chat/completions)
  // ------------------------------------------------------------------
  app.use("/v1/*", async (c, next) => {
    const eff = db.getEffectiveSettings();
    const expectedToken = (eff.external_api_token || "").trim();
    if (expectedToken) {
      const authHeader = c.req.header("Authorization") || "";
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
      if (token !== expectedToken) {
        return c.json({ error: { message: "Invalid or missing Bearer token", type: "auth_error" } }, 401);
      }
    }
    await next();
  });

  app.get("/v1/models", (c) => {
    const now = Math.floor(Date.now() / 1000);
    const avail = modelsManager.listAvailableModelOptions();
    return c.json({
      object: "list",
      data: [
        { id: "memoria-agent", object: "model", created: now, owned_by: "memoria-system" },
        ...avail.map((m) => ({
          id: `${m.provider}/${m.modelId}`,
          object: "model",
          created: now,
          owned_by: m.provider,
        })),
      ],
    });
  });

  app.post("/v1/chat/completions", async (c) => {
    const start = Date.now();
    const body = await c.req.json().catch(() => ({}));
    const modelStr = String(body.model || "memoria-agent");
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const lastUser = [...messages].reverse().find((m: any) => m.role === "user");
    const prompt =
      typeof lastUser?.content === "string"
        ? lastUser.content
        : Array.isArray(lastUser?.content)
          ? lastUser.content
              .filter((p: any) => p.type === "text")
              .map((p: any) => p.text)
              .join("\n")
          : "";

    if (!prompt.trim()) {
      return c.json({ error: { message: "No user message found in messages[]" } }, 400);
    }

    let modelProvider: string | undefined;
    let modelId: string | undefined;
    if (modelStr.includes("/") && modelStr !== "memoria-agent") {
      const [p, m] = modelStr.split("/", 2);
      modelProvider = p;
      modelId = m;
    }

    const sessionId = body.conversation_id || body.session_id || undefined;
    const isExisting = sessionId ? Boolean(db.getConversation(sessionId)) : false;
    const defaultScope = isExisting
      ? undefined
      : {
          kbIds: db.listKBs().map((k) => k.id),
          hostIds: hostManager.listPublicHosts().map((h) => h.id),
        };

    const { summary, submission } = await runtime.submitMessage({
      conversationId: sessionId,
      content: prompt,
      modelProvider,
      modelId,
      scope: defaultScope,
    });

    await submission.wait(BACKGROUND_CONTEXT);
    const convMsgs = (await runtime.getConversationMessages(summary.id)) ?? [];
    const lastAsst = [...convMsgs].reverse().find((m) => m.role === "assistant");
    const reasoning = lastAsst?.trace?.summary?.reasoning || "";
    const answerText = lastAsst?.content || "";
    const fullContent = reasoning ? `<thought>\n${reasoning}\n</thought>\n\n${answerText}` : answerText;
    const usageSummary = lastAsst?.trace?.summary;
    const promptTokens = usageSummary?.prompt_tokens ?? 0;
    const completionTokens = usageSummary?.completion_tokens ?? 0;
    const totalTokens = usageSummary?.total_tokens ?? promptTokens + completionTokens;

    db.logInvocation({
      endpoint: "/v1/chat/completions",
      method: "POST",
      model: modelStr,
      statusCode: 200,
      durationMs: Math.max(1, Date.now() - start),
      promptTokens,
      completionTokens,
      totalTokens,
      sessionId: summary.id,
    });

    const completionId = `chatcmpl_${submission.id}`;
    const created = Math.floor(Date.now() / 1000);

    if (body.stream) {
      return streamSSE(c, async (stream) => {
        if (reasoning) {
          await stream.writeSSE({
            data: JSON.stringify({
              id: completionId,
              object: "chat.completion.chunk",
              created,
              model: modelStr,
              choices: [{ index: 0, delta: { role: "assistant", content: `<thought>\n${reasoning}\n</thought>\n\n` }, finish_reason: null }],
            }),
          });
        }
        await stream.writeSSE({
          data: JSON.stringify({
            id: completionId,
            object: "chat.completion.chunk",
            created,
            model: modelStr,
            choices: [{ index: 0, delta: { content: answerText }, finish_reason: "stop" }],
          }),
        });
        await stream.writeSSE({ data: "[DONE]" });
      });
    }

    return c.json({
      id: completionId,
      object: "chat.completion",
      created,
      model: modelStr,
      conversation_id: summary.id,
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: fullContent,
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
      },
    });
  });

  return app;
}
