import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { applySqliteMigrations, SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import { NodeSqliteDatabase } from "@earendil-works/pi-durable/storage/sqlite/node";
import type {
  ConversationScope,
  ConversationSummary,
  HostSecurityMode,
  ModelProviderConfig,
  SettingsMap,
  ThinkingLevel,
} from "../../shared/types.ts";

export const DEFAULT_HOST_DANGEROUS_PATTERNS = [
  String.raw`\brm\s+-(?:[a-zA-Z]*r[a-zA-Z]*f|[a-zA-Z]*f[a-zA-Z]*r)\s+(?:/|/\*|\.\.|\./\.\.)(?:\s|$)`,
  String.raw`\brm\s+-[a-zA-Z]*\s+(?:/|/\*)(?:\s|$)`,
  String.raw`\bmkfs(?:\.\w+)?\b`,
  String.raw`\bfdisk\b`,
  String.raw`\bdd\s+if=.*of=/dev/[a-z0-9]+`,
  String.raw`\b(?:reboot|shutdown|poweroff|init\s+0|init\s+6)\b`,
  String.raw`>\s*/dev/(?:sd[a-z]|nvme[0-9]|hd[a-z])`,
  String.raw`\bchmod\s+-[a-zA-Z]*R[a-zA-Z]*\s+[0-7]*777\s+(?:/|/\*)(?:\s|$)`,
  String.raw`\bchown\s+-[a-zA-Z]*R[a-zA-Z]*\s+\S+\s+(?:/|/\*)(?:\s|$)`,
  String.raw`(?:^|[|;&\s])(?:sudo\s+)?(?:passwd|chpasswd)(?:\s|$)`,
  String.raw`:\(\)\s*\{[^}]*:\s*\|[^}]*&\s*\}`,
];

export const DEFAULT_SYSTEM_PROMPT = `你是一个专业的智能助手。请全程使用简体中文进行思考（包括思维链/CoT推理）与回答。

如果系统提供了参考资料，请优先基于参考资料回答问题，并保持回答简洁准确。若参考资料不足以回答问题，可结合自身知识补充，但需说明哪部分来自推断而非资料。`;

export const DEFAULT_SCOPE: ConversationScope = {
  kbIds: [],
  hostIds: [],
  hostSecurityModes: {},
  webSearch: false,
  subagentEnabled: true,
};

function nowIso(): string {
  return new Date().toISOString();
}

export function maskSecret(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "******";
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

export class AppDatabase {
  readonly raw: DatabaseSync;
  readonly dbPath: string;

  constructor(dbPath = process.env.DB_PATH || "./data/memoria.db") {
    this.dbPath = dbPath;
    if (dbPath !== ":memory:") {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    this.raw = new DatabaseSync(dbPath);
    try {
      try {
        this.raw.exec("PRAGMA journal_mode = WAL");
        if (dbPath !== ":memory:") {
          this.raw.exec("BEGIN IMMEDIATE; COMMIT;");
        }
      } catch {
        this.raw.exec("PRAGMA locking_mode = EXCLUSIVE");
        this.raw.exec("PRAGMA journal_mode = DELETE");
        this.raw.exec("PRAGMA locking_mode = NORMAL");
      }
      this.raw.exec("PRAGMA synchronous = NORMAL");
      this.raw.exec("PRAGMA foreign_keys = ON");
      this.raw.exec("PRAGMA busy_timeout = 5000");
      this.initSchema();
    } catch (err) {
      this.close();
      throw err;
    }
  }

  private hasTable(tableName: string): boolean {
    const row = this.raw
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName);
    return Boolean(row);
  }

  private hasColumn(tableName: string, columnName: string): boolean {
    if (!this.hasTable(tableName)) return false;
    const cols = this.raw.prepare(`PRAGMA table_info("${tableName}")`).all() as Array<{ name: string }>;
    return cols.some((c) => c.name === columnName);
  }

  private initSchema(): void {
    if (this.hasTable("vault_files") && !this.hasColumn("vault_files", "kb_id")) {
      this.raw.exec("DROP TABLE vault_files");
    }
    if (this.hasTable("tasks") && this.hasColumn("tasks", "task_type")) {
      this.raw.exec("DROP TABLE tasks");
    }
    if (this.hasTable("bot_host_links")) {
      this.raw.exec("DROP TABLE bot_host_links");
    }
    if (this.hasTable("bot_kb_links")) {
      this.raw.exec("DROP TABLE bot_kb_links");
    }

    this.raw.exec(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS model_providers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        protocol TEXT NOT NULL DEFAULT 'openai-completions',
        base_url TEXT NOT NULL,
        api_key TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1,
        models_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_conversations (
        id TEXT PRIMARY KEY,
        durable_id INTEGER NOT NULL UNIQUE,
        title TEXT NOT NULL,
        channel TEXT NOT NULL DEFAULT 'web',
        model_provider TEXT NOT NULL DEFAULT 'default',
        model_id TEXT NOT NULL DEFAULT '',
        thinking_level TEXT NOT NULL DEFAULT 'off',
        scope_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_app_conversations_updated ON app_conversations(updated_at DESC);

      CREATE TABLE IF NOT EXISTS knowledge_bases (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        type TEXT NOT NULL DEFAULT 'upload',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS kb_documents (
        id TEXT PRIMARY KEY,
        kb_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
        filename TEXT NOT NULL,
        path TEXT,
        source TEXT NOT NULL DEFAULT 'upload',
        content TEXT NOT NULL DEFAULT '',
        chunk_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_kb_documents_kb ON kb_documents(kb_id);

      CREATE TABLE IF NOT EXISTS kb_chunks (
        id TEXT PRIMARY KEY,
        kb_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
        doc_id TEXT NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        text TEXT NOT NULL,
        segmented_text TEXT NOT NULL DEFAULT '',
        embedding BLOB,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_kb_chunks_kb ON kb_chunks(kb_id);
      CREATE INDEX IF NOT EXISTS idx_kb_chunks_doc ON kb_chunks(doc_id);

      CREATE VIRTUAL TABLE IF NOT EXISTS kb_chunks_fts USING fts5(
        chunk_id UNINDEXED,
        kb_id UNINDEXED,
        doc_id UNINDEXED,
        segmented_text
      );

      CREATE TABLE IF NOT EXISTS vaults (
        id TEXT PRIMARY KEY,
        kb_id TEXT NOT NULL UNIQUE REFERENCES knowledge_bases(id) ON DELETE CASCADE,
        type TEXT NOT NULL DEFAULT 'local',
        local_path TEXT,
        webdav_url TEXT,
        webdav_path TEXT,
        webdav_username TEXT,
        webdav_password TEXT,
        last_synced_at TEXT,
        syncing INTEGER NOT NULL DEFAULT 0,
        auto_sync INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS vault_files (
        id TEXT PRIMARY KEY,
        vault_id TEXT NOT NULL REFERENCES vaults(id) ON DELETE CASCADE,
        kb_id TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
        doc_id TEXT NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,
        rel_path TEXT NOT NULL,
        file_hash TEXT NOT NULL,
        mtime_ms REAL NOT NULL DEFAULT 0,
        synced_at TEXT NOT NULL,
        UNIQUE(vault_id, rel_path)
      );

      CREATE TABLE IF NOT EXISTS hosts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER NOT NULL DEFAULT 22,
        username TEXT NOT NULL,
        auth_type TEXT NOT NULL DEFAULT 'password',
        credential TEXT NOT NULL DEFAULT '',
        proxy_url TEXT NOT NULL DEFAULT '',
        default_cwd TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        tags_json TEXT NOT NULL DEFAULT '[]',
        safe_mode INTEGER NOT NULL DEFAULT 1,
        security_mode TEXT NOT NULL DEFAULT 'ask_confirmation',
        status TEXT NOT NULL DEFAULT 'inactive',
        os_info TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS invocation_logs (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        method TEXT NOT NULL,
        model TEXT NOT NULL,
        status_code INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        session_id TEXT,
        error_msg TEXT
      );

      CREATE TABLE IF NOT EXISTS qqbot_logs (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        category TEXT NOT NULL,
        level TEXT NOT NULL,
        event_type TEXT NOT NULL,
        source_type TEXT,
        source_id TEXT,
        user_name TEXT,
        summary TEXT NOT NULL,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        details TEXT
      );
    `);

    if (this.hasTable("runtime_settings")) {
      this.raw.exec(`
        INSERT OR IGNORE INTO app_settings (key, value, updated_at)
        SELECT "key", value, updated_at FROM runtime_settings
      `);
    }
    if (this.hasTable("api_invocation_logs")) {
      this.raw.exec(`
        INSERT OR IGNORE INTO invocation_logs (
          id, timestamp, endpoint, method, model, status_code, duration_ms,
          prompt_tokens, completion_tokens, total_tokens, session_id, error_msg
        )
        SELECT
          id, timestamp, endpoint, method, model, status_code, duration_ms,
          prompt_tokens, completion_tokens, total_tokens, session_id, error_msg
        FROM api_invocation_logs
      `);
    }

    // ADR 0008: Migrate legacy openai_base_url / openai_api_key to embedding_base_url / embedding_api_key
    try {
      const legacyUrlRow = this.raw.prepare("SELECT value FROM app_settings WHERE key = 'openai_base_url'").get() as { value: string } | undefined;
      const newUrlRow = this.raw.prepare("SELECT value FROM app_settings WHERE key = 'embedding_base_url'").get() as { value: string } | undefined;
      if (legacyUrlRow?.value && !newUrlRow) {
        this.setSetting("embedding_base_url", legacyUrlRow.value);
      }
      const legacyKeyRow = this.raw.prepare("SELECT value FROM app_settings WHERE key = 'openai_api_key'").get() as { value: string } | undefined;
      const newKeyRow = this.raw.prepare("SELECT value FROM app_settings WHERE key = 'embedding_api_key'").get() as { value: string } | undefined;
      if (legacyKeyRow?.value && !newKeyRow) {
        this.setSetting("embedding_api_key", legacyKeyRow.value);
      }
    } catch {
      // ignore
    }
    if (this.hasTable("documents") && this.hasColumn("documents", "kb_id")) {
      this.raw.exec(`
        INSERT OR IGNORE INTO kb_documents (id, kb_id, filename, path, source, content, chunk_count, created_at)
        SELECT id, kb_id, filename, path, source, '', COALESCE(chunk_count, 0), created_at FROM documents;
        DROP TABLE documents;
      `);
    }
    if (!this.hasColumn("hosts", "default_cwd")) {
      this.raw.exec("ALTER TABLE hosts ADD COLUMN default_cwd TEXT NOT NULL DEFAULT ''");
    }
    if (!this.hasColumn("hosts", "tags_json")) {
      this.raw.exec("ALTER TABLE hosts ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]'");
    }
    if (this.hasColumn("hosts", "tags")) {
      this.raw.exec(`
        UPDATE hosts
        SET tags_json = COALESCE(tags, '[]')
        WHERE (tags_json = '[]' OR tags_json = '') AND tags IS NOT NULL AND tags != ''
      `);
    }

    this.ensureDefaultProvider();
  }

  async openDurableStorage(): Promise<SqliteStorage> {
    const nodeDb = new NodeSqliteDatabase(this.raw);
    await applySqliteMigrations(nodeDb);
    return SqliteStorage.open(nodeDb);
  }

  // ------------------------------------------------------------------
  // Settings
  // ------------------------------------------------------------------
  getAllRawSettings(): Record<string, string> {
    const rows = this.raw.prepare("SELECT key, value FROM app_settings").all() as Array<{
      key: string;
      value: string;
    }>;
    const out: Record<string, string> = {};
    for (const r of rows) {
      out[r.key] = r.value;
    }
    return out;
  }

  setSetting(key: string, value: string): void {
    const now = nowIso();
    this.raw
      .prepare(
        `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, value, now);
  }

  getEffectiveSettings(): SettingsMap {
    const overrides = this.getAllRawSettings();
    const rawEmbedUrl = overrides.embedding_base_url || overrides.openai_base_url || process.env.EMBEDDING_BASE_URL || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
    let normalizedEmbedUrl = rawEmbedUrl.replace(/\/+$/, "");
    if (!normalizedEmbedUrl.endsWith("/v1") && !normalizedEmbedUrl.includes("anthropic") && !normalizedEmbedUrl.includes("googleapis")) {
      normalizedEmbedUrl += "/v1";
    }

    const embedApiKey = overrides.embedding_api_key ?? overrides.openai_api_key ?? process.env.EMBEDDING_API_KEY ?? process.env.OPENAI_API_KEY ?? "";
    const llmModel = overrides.llm_model || process.env.LLM_MODEL || "deepseek-v4-flash";
    const embeddingModel = overrides.embedding_model || process.env.EMBEDDING_MODEL || "text-embedding-3-large";

    return {
      embedding_base_url: normalizedEmbedUrl,
      embedding_api_key: embedApiKey,
      openai_base_url: normalizedEmbedUrl,
      openai_api_key: embedApiKey,
      external_api_token: overrides.external_api_token ?? process.env.EXTERNAL_API_TOKEN ?? "",
      embedding_provider: overrides.embedding_provider || overrides.default_provider || "default",
      embedding_model: embeddingModel,
      llm_model: llmModel,
      default_provider: overrides.default_provider || "default",
      default_thinking_level: (overrides.default_thinking_level as ThinkingLevel) || "medium",
      system_prompt: overrides.system_prompt ?? process.env.SYSTEM_PROMPT ?? DEFAULT_SYSTEM_PROMPT,
      top_k: overrides.top_k ?? process.env.TOP_K ?? "5",
      min_score: overrides.min_score ?? process.env.MIN_SCORE ?? "0.5",
      chunk_size: overrides.chunk_size ?? process.env.CHUNK_SIZE ?? "512",
      chunk_overlap: overrides.chunk_overlap ?? process.env.CHUNK_OVERLAP ?? "128",
      vault_sync_interval_minutes: overrides.vault_sync_interval_minutes ?? "15",
      host_dangerous_patterns:
        overrides.host_dangerous_patterns ?? JSON.stringify(DEFAULT_HOST_DANGEROUS_PATTERNS),
      enable_web_search:
        overrides.enable_web_search ?? (process.env.ENABLE_WEB_SEARCH === "true" ? "true" : "false"),
      web_search_provider: overrides.web_search_provider ?? process.env.WEB_SEARCH_PROVIDER ?? "duckduckgo",
      web_search_api_key: overrides.web_search_api_key ?? process.env.WEB_SEARCH_API_KEY ?? "",
      web_search_endpoint: overrides.web_search_endpoint ?? process.env.WEB_SEARCH_ENDPOINT ?? "",
    };
  }

  getQQSettings(): Record<string, string> {
    const raw = this.getAllRawSettings();
    const defaults: Record<string, string> = {
      enabled: "false",
      app_id: "",
      client_secret: "",
      gateway_intents: "0",
      c2c_enabled: "true",
      group_enabled: "true",
      group_require_mention: "true",
      user_allowlist: "[]",
      group_allowlist: "[]",
      allow_unlisted_users: "false",
      allow_unlisted_groups: "false",
      group_approval_enabled: "false",
      max_queue_size: "32",
      run_timeout_seconds: "300",
    };
    for (const key of Object.keys(defaults)) {
      if (`qq_${key}` in raw) {
        defaults[key] = raw[`qq_${key}`];
      }
    }
    return defaults;
  }

  // ------------------------------------------------------------------
  // Multi-Model Providers
  // ------------------------------------------------------------------
  ensureDefaultProvider(): void {
    const existing = this.raw
      .prepare("SELECT id FROM model_providers WHERE id = 'default'")
      .get() as { id: string } | undefined;
    const eff = this.getEffectiveSettings();
    const now = nowIso();
    if (!existing) {
      const defaultModels = [
        {
          id: eff.llm_model || "deepseek-v4-flash",
          name: eff.llm_model || "deepseek-v4-flash",
          reasoning: true,
          contextWindow: 128000,
          maxTokens: 8192,
        },
      ];
      this.raw
        .prepare(
          `INSERT INTO model_providers (id, name, protocol, base_url, api_key, enabled, models_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          "default",
          "默认渠道 (OpenAI 兼容)",
          "openai-completions",
          eff.openai_base_url,
          eff.openai_api_key,
          1,
          JSON.stringify(defaultModels),
          now,
          now,
        );
    }
  }

  syncDefaultProviderFromSettings(): void {
    // Deprecated per ADR 0008: Providers are now managed independently without implicit overrides.
  }

  listProviders(includeRawSecrets = false): ModelProviderConfig[] {
    this.ensureDefaultProvider();
    const rows = this.raw
      .prepare("SELECT * FROM model_providers ORDER BY CASE WHEN id = 'default' THEN 0 ELSE 1 END, created_at ASC")
      .all() as Array<{
      id: string;
      name: string;
      protocol: ModelProviderConfig["protocol"];
      base_url: string;
      api_key: string;
      enabled: number;
      models_json: string;
    }>;
    return rows.map((r) => {
      let models = [];
      try {
        models = JSON.parse(r.models_json);
      } catch {
        models = [];
      }
      return {
        id: r.id,
        name: r.name,
        protocol: r.protocol,
        baseUrl: r.base_url,
        apiKey: includeRawSecrets ? r.api_key : maskSecret(r.api_key),
        apiKeyMasked: maskSecret(r.api_key),
        hasApiKey: Boolean(r.api_key),
        enabled: Boolean(r.enabled),
        models,
      };
    });
  }

  upsertProvider(input: {
    id?: string;
    name: string;
    protocol?: ModelProviderConfig["protocol"];
    baseUrl: string;
    apiKey?: string;
    enabled?: boolean;
    models?: ModelProviderConfig["models"];
  }): ModelProviderConfig {
    const id = input.id?.trim() || `prov_${randomUUID().slice(0, 8)}`;
    const existing = this.raw
      .prepare("SELECT * FROM model_providers WHERE id = ?")
      .get(id) as
      | {
          id: string;
          name: string;
          protocol: ModelProviderConfig["protocol"];
          base_url: string;
          api_key: string;
          enabled: number;
          models_json: string;
          created_at: string;
        }
      | undefined;

    const now = nowIso();
    const protocol = input.protocol ?? existing?.protocol ?? "openai-completions";
    const baseUrl = input.baseUrl.trim();
    const resolvedKey =
      input.apiKey === undefined || input.apiKey.includes("****") || input.apiKey === "******"
        ? (existing?.api_key ?? "")
        : input.apiKey;
    const enabled = input.enabled === undefined ? (existing ? Boolean(existing.enabled) : true) : input.enabled;
    const models =
      input.models ??
      (existing
        ? (() => {
            try {
              return JSON.parse(existing.models_json);
            } catch {
              return [];
            }
          })()
        : []);

    if (existing) {
      this.raw
        .prepare(
          `UPDATE model_providers
           SET name = ?, protocol = ?, base_url = ?, api_key = ?, enabled = ?, models_json = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          input.name,
          protocol,
          baseUrl,
          resolvedKey,
          enabled ? 1 : 0,
          JSON.stringify(models),
          now,
          id,
        );
    } else {
      this.raw
        .prepare(
          `INSERT INTO model_providers (id, name, protocol, base_url, api_key, enabled, models_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.name,
          protocol,
          baseUrl,
          resolvedKey,
          enabled ? 1 : 0,
          JSON.stringify(models),
          now,
          now,
        );
    }

    // ADR 0008: Provider configs are now completely decoupled from embedding settings.
    return this.listProviders(false).find((p) => p.id === id)!;
  }

  deleteProvider(id: string): boolean {
    if (id === "default") {
      throw new Error("Default provider cannot be deleted");
    }
    const res = this.raw.prepare("DELETE FROM model_providers WHERE id = ?").run(id);
    return Number(res.changes) > 0;
  }

  // ------------------------------------------------------------------
  // Conversations Index
  // ------------------------------------------------------------------
  registerConversation(params: {
    id?: string;
    durableId: number;
    title?: string;
    channel?: "web" | "openai" | "qq";
    modelProvider?: string;
    modelId?: string;
    thinkingLevel?: ThinkingLevel;
    scope?: Partial<ConversationScope>;
  }): ConversationSummary {
    const eff = this.getEffectiveSettings();
    const id = params.id || String(params.durableId);
    const now = nowIso();
    const scope: ConversationScope = {
      ...DEFAULT_SCOPE,
      webSearch: eff.enable_web_search === "true",
      ...params.scope,
    };
    const modelProvider = params.modelProvider || eff.default_provider || "default";
    const modelId = params.modelId || eff.llm_model;
    const thinkingLevel = params.thinkingLevel || eff.default_thinking_level || "medium";
    const title = params.title || "新对话";
    const channel = params.channel || "web";

    this.raw
      .prepare(
        `INSERT INTO app_conversations (
          id, durable_id, title, channel, model_provider, model_id, thinking_level, scope_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          updated_at = excluded.updated_at`,
      )
      .run(
        id,
        params.durableId,
        title,
        channel,
        modelProvider,
        modelId,
        thinkingLevel,
        JSON.stringify(scope),
        now,
        now,
      );

    return this.getConversation(id)!;
  }

  getConversation(idOrDurableId: string | number): ConversationSummary | undefined {
    const key = String(idOrDurableId);
    const row = this.raw
      .prepare("SELECT * FROM app_conversations WHERE id = ? OR CAST(durable_id AS TEXT) = ?")
      .get(key, key) as
      | {
          id: string;
          durable_id: number;
          title: string;
          channel: "web" | "openai" | "qq";
          model_provider: string;
          model_id: string;
          thinking_level: ThinkingLevel;
          scope_json: string;
          created_at: string;
          updated_at: string;
        }
      | undefined;

    if (!row) return undefined;
    let scope = { ...DEFAULT_SCOPE };
    try {
      scope = { ...DEFAULT_SCOPE, ...JSON.parse(row.scope_json) };
    } catch {
      // ignore invalid JSON
    }
    return {
      id: row.id,
      durableId: Number(row.durable_id),
      title: row.title,
      channel: row.channel,
      modelProvider: row.model_provider,
      modelId: row.model_id,
      thinkingLevel: row.thinking_level,
      scope,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  listConversations(channel?: "web" | "openai" | "qq"): ConversationSummary[] {
    const rows = (
      channel
        ? this.raw
            .prepare("SELECT id FROM app_conversations WHERE channel = ? ORDER BY updated_at DESC")
            .all(channel)
        : this.raw.prepare("SELECT id FROM app_conversations ORDER BY updated_at DESC").all()
    ) as Array<{ id: string }>;
    return rows.map((r) => this.getConversation(r.id)!).filter(Boolean);
  }

  updateConversationMeta(
    id: string,
    patch: {
      title?: string;
      modelProvider?: string;
      modelId?: string;
      thinkingLevel?: ThinkingLevel;
      scope?: ConversationScope;
    },
  ): ConversationSummary | undefined {
    const existing = this.getConversation(id);
    if (!existing) return undefined;

    const title = patch.title ?? existing.title;
    const modelProvider = patch.modelProvider ?? existing.modelProvider;
    const modelId = patch.modelId ?? existing.modelId;
    const thinkingLevel = patch.thinkingLevel ?? existing.thinkingLevel;
    const scope = patch.scope ?? existing.scope;
    const now = nowIso();

    this.raw
      .prepare(
        `UPDATE app_conversations
         SET title = ?, model_provider = ?, model_id = ?, thinking_level = ?, scope_json = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(title, modelProvider, modelId, thinkingLevel, JSON.stringify(scope), now, existing.id);

    return this.getConversation(existing.id);
  }

  touchConversation(id: string, maybeTitle?: string): void {
    const existing = this.getConversation(id);
    if (!existing) return;
    const nextTitle =
      maybeTitle && (existing.title === "新对话" || existing.title === "New Chat")
        ? maybeTitle.slice(0, 48)
        : existing.title;
    this.raw
      .prepare("UPDATE app_conversations SET title = ?, updated_at = ? WHERE id = ?")
      .run(nextTitle, nowIso(), existing.id);
  }

  deleteConversation(id: string): boolean {
    const existing = this.getConversation(id);
    if (!existing) return false;
    const res = this.raw.prepare("DELETE FROM app_conversations WHERE id = ?").run(existing.id);
    return Number(res.changes) > 0;
  }

  truncateConversationEntries(durableId: number, targetEntryId: number, inclusive = true): number {
    const rows = this.raw
      .prepare("SELECT id, record FROM entries WHERE conversation_id = ? ORDER BY id ASC")
      .all(durableId) as Array<{ id: number; record: string }>;
    if (rows.length === 0) return 0;

    const ids = rows.map((r) => r.id);
    const idx = ids.indexOf(targetEntryId);
    if (idx === -1) return 0;

    let startIndex = idx;
    if (inclusive) {
      try {
        const rec = JSON.parse(rows[idx].record);
        if (rec.kind === "pi.assistant") {
          let i = idx - 1;
          while (i >= 0) {
            const prevRec = JSON.parse(rows[i].record);
            if (
              prevRec.kind === "pi.tool-result" ||
              (prevRec.kind === "pi.assistant" &&
                prevRec.model?.[0]?.content?.some((b: any) => b.type === "toolCall"))
            ) {
              startIndex = i;
              i--;
            } else {
              break;
            }
          }
        }
      } catch {}
    } else {
      startIndex = idx + 1;
    }

    const targetIds = ids.slice(startIndex);
    if (targetIds.length === 0) return 0;

    const ph = targetIds.map(() => "?").join(",");
    this.raw
      .prepare(`DELETE FROM entries WHERE conversation_id = ? AND id IN (${ph})`)
      .run(durableId, ...targetIds);

    const subRows = this.raw
      .prepare("SELECT id, record FROM submissions WHERE conversation_id = ?")
      .all(durableId) as Array<{ id: number; record: string }>;
    const subIdsToDelete: number[] = [];
    for (const sub of subRows) {
      try {
        const rec = JSON.parse(sub.record);
        if (
          (rec.entry && targetIds.includes(rec.entry)) ||
          (rec.answer && targetIds.includes(rec.answer)) ||
          targetIds.includes(sub.id)
        ) {
          subIdsToDelete.push(sub.id);
        }
      } catch {}
    }
    if (subIdsToDelete.length > 0) {
      const subPh = subIdsToDelete.map(() => "?").join(",");
      this.raw.prepare(`DELETE FROM submissions WHERE id IN (${subPh})`).run(...subIdsToDelete);
    }

    const taskRows = this.raw
      .prepare("SELECT id, record FROM tasks WHERE conversation_id = ?")
      .all(durableId) as Array<{ id: number; record: string }>;
    const taskIdsToDelete: number[] = [];
    for (const task of taskRows) {
      try {
        const rec = JSON.parse(task.record);
        if (
          targetIds.includes(task.id) ||
          (rec.checkpoint?.assistant && targetIds.includes(rec.checkpoint.assistant)) ||
          (rec.checkpoint?.cutoff && targetIds.includes(rec.checkpoint.cutoff))
        ) {
          taskIdsToDelete.push(task.id);
        }
      } catch {}
    }
    if (taskIdsToDelete.length > 0) {
      const taskPh = taskIdsToDelete.map(() => "?").join(",");
      this.raw.prepare(`DELETE FROM tasks WHERE id IN (${taskPh})`).run(...taskIdsToDelete);
    }

    const allDeletedIds = Array.from(new Set([...targetIds, ...subIdsToDelete, ...taskIdsToDelete]));
    if (allDeletedIds.length > 0) {
      const allPh = allDeletedIds.map(() => "?").join(",");
      this.raw.prepare(`DELETE FROM record_ids WHERE id IN (${allPh})`).run(...allDeletedIds);
    }

    const remainingCount = (
      this.raw
        .prepare("SELECT COUNT(*) as c FROM entries WHERE conversation_id = ?")
        .get(durableId) as { c: number }
    )?.c ?? 0;

    const now = nowIso();
    if (remainingCount === 0) {
      this.raw
        .prepare("UPDATE app_conversations SET title = '新对话', updated_at = ? WHERE durable_id = ?")
        .run(now, durableId);
    } else {
      this.raw
        .prepare("UPDATE app_conversations SET updated_at = ? WHERE durable_id = ?")
        .run(now, durableId);
    }

    return targetIds.length;
  }

  // ------------------------------------------------------------------
  // Knowledge Bases & Hosts (Metadata for Scope Toggles & Management)
  // ------------------------------------------------------------------
  listKBs(): Array<{ id: string; name: string; description: string; type: "upload" | "vault"; created_at: string }> {
    return this.raw
      .prepare("SELECT id, name, description, type, created_at FROM knowledge_bases ORDER BY created_at DESC")
      .all() as Array<{ id: string; name: string; description: string; type: "upload" | "vault"; created_at: string }>;
  }

  getKB(id: string) {
    return this.raw
      .prepare("SELECT id, name, description, type, created_at FROM knowledge_bases WHERE id = ?")
      .get(id) as
      | { id: string; name: string; description: string; type: "upload" | "vault"; created_at: string }
      | undefined;
  }

  createKB(input: { name: string; description?: string; type?: "upload" | "vault" }) {
    const id = `kb_${randomUUID().slice(0, 8)}`;
    const now = nowIso();
    this.raw
      .prepare("INSERT INTO knowledge_bases (id, name, description, type, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, input.name, input.description ?? "", input.type ?? "upload", now);
    return this.getKB(id)!;
  }

  updateKB(id: string, input: { name?: string; description?: string }) {
    const kb = this.getKB(id);
    if (!kb) return undefined;
    this.raw
      .prepare("UPDATE knowledge_bases SET name = ?, description = ? WHERE id = ?")
      .run(input.name ?? kb.name, input.description ?? kb.description, id);
    return this.getKB(id);
  }

  deleteKB(id: string): boolean {
    const res = this.raw.prepare("DELETE FROM knowledge_bases WHERE id = ?").run(id);
    this.raw.prepare("DELETE FROM kb_chunks_fts WHERE kb_id = ?").run(id);
    return Number(res.changes) > 0;
  }

  listDocs(kbId?: string) {
    if (kbId) {
      return this.raw
        .prepare(
          "SELECT id, kb_id, filename, path, source, chunk_count, created_at FROM kb_documents WHERE kb_id = ? ORDER BY created_at DESC",
        )
        .all(kbId);
    }
    return this.raw
      .prepare("SELECT id, kb_id, filename, path, source, chunk_count, created_at FROM kb_documents ORDER BY created_at DESC")
      .all();
  }

  listHosts() {
    const rows = this.raw.prepare("SELECT * FROM hosts ORDER BY created_at DESC").all() as Array<any>;
    return rows.map((r) => this.formatHostRow(r));
  }

  getHost(id: string) {
    const row = this.raw.prepare("SELECT * FROM hosts WHERE id = ?").get(id) as any;
    return row ? this.formatHostRow(row) : undefined;
  }

  createHost(input: {
    name: string;
    host: string;
    port?: number;
    username: string;
    auth_type?: "password" | "key";
    credential?: string;
    proxy_url?: string;
    default_cwd?: string;
    description?: string;
    tags?: string[];
    safe_mode?: boolean;
    security_mode?: HostSecurityMode;
  }) {
    const id = `host_${randomUUID().slice(0, 8)}`;
    const now = nowIso();
    const securityMode = input.security_mode ?? (input.safe_mode === false ? "unrestricted" : "ask_confirmation");
    this.raw
      .prepare(
        `INSERT INTO hosts (
          id, name, host, port, username, auth_type, credential, proxy_url, default_cwd,
          description, tags_json, safe_mode, security_mode, status, os_info, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'inactive', '', ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.host,
        input.port ?? 22,
        input.username,
        input.auth_type ?? "password",
        input.credential ?? "",
        input.proxy_url ?? "",
        input.default_cwd ?? "",
        input.description ?? "",
        JSON.stringify(input.tags ?? []),
        securityMode === "unrestricted" ? 0 : 1,
        securityMode,
        now,
        now,
      );
    return this.getHost(id)!;
  }

  deleteHost(id: string): boolean {
    const res = this.raw.prepare("DELETE FROM hosts WHERE id = ?").run(id);
    return Number(res.changes) > 0;
  }

  // ------------------------------------------------------------------
  // Invocation & QQBot Audit Logs
  // ------------------------------------------------------------------
  logInvocation(entry: {
    endpoint: string;
    method: string;
    model: string;
    statusCode: number;
    durationMs: number;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
    sessionId?: string | null;
    errorMsg?: string | null;
  }): void {
    const id = `inv_${randomUUID().slice(0, 10)}`;
    this.raw
      .prepare(
        `INSERT INTO invocation_logs (
          id, timestamp, endpoint, method, model, status_code, duration_ms,
          prompt_tokens, completion_tokens, total_tokens, session_id, error_msg
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        nowIso(),
        entry.endpoint,
        entry.method,
        entry.model,
        entry.statusCode,
        entry.durationMs,
        entry.promptTokens ?? 0,
        entry.completionTokens ?? 0,
        entry.totalTokens ?? 0,
        entry.sessionId ?? null,
        entry.errorMsg ?? null,
      );
  }

  listInvocations(limit = 100, offset = 0) {
    return this.raw
      .prepare("SELECT * FROM invocation_logs ORDER BY timestamp DESC LIMIT ? OFFSET ?")
      .all(limit, offset);
  }

  clearInvocations(): void {
    this.raw.prepare("DELETE FROM invocation_logs").run();
  }

  logQQBotEvent(entry: {
    category: string;
    level: string;
    eventType: string;
    sourceType?: string | null;
    sourceId?: string | null;
    userName?: string | null;
    summary: string;
    durationMs?: number;
    details?: string | null;
  }): void {
    const id = `qqlog_${randomUUID().slice(0, 10)}`;
    this.raw
      .prepare(
        `INSERT INTO qqbot_logs (
          id, timestamp, category, level, event_type, source_type, source_id, user_name, summary, duration_ms, details
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        nowIso(),
        entry.category,
        entry.level,
        entry.eventType,
        entry.sourceType ?? null,
        entry.sourceId ?? null,
        entry.userName ?? null,
        entry.summary,
        entry.durationMs ?? 0,
        entry.details ?? null,
      );
  }

  listQQBotLogs(params?: { category?: string; level?: string; limit?: number; offset?: number }) {
    const limit = params?.limit ?? 100;
    const offset = params?.offset ?? 0;
    const clauses: string[] = [];
    const args: any[] = [];
    if (params?.category) {
      clauses.push("category = ?");
      args.push(params.category);
    }
    if (params?.level) {
      clauses.push("level = ?");
      args.push(params.level);
    }
    const whereSql = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    return this.raw
      .prepare(`SELECT * FROM qqbot_logs ${whereSql} ORDER BY timestamp DESC LIMIT ? OFFSET ?`)
      .all(...args, limit, offset);
  }

  getQQBotStats() {
    const total = (this.raw.prepare("SELECT COUNT(*) AS c FROM qqbot_logs").get() as any)?.c ?? 0;
    const msgCount =
      (this.raw.prepare("SELECT COUNT(*) AS c FROM qqbot_logs WHERE category = 'message'").get() as any)?.c ?? 0;
    const connCount =
      (this.raw.prepare("SELECT COUNT(*) AS c FROM qqbot_logs WHERE category = 'connection'").get() as any)?.c ??
      0;
    const errCount =
      (this.raw.prepare("SELECT COUNT(*) AS c FROM qqbot_logs WHERE level = 'ERROR'").get() as any)?.c ?? 0;
    const lastRow = this.raw
      .prepare("SELECT timestamp FROM qqbot_logs ORDER BY timestamp DESC LIMIT 1")
      .get() as { timestamp: string } | undefined;
    return {
      total_events: Number(total),
      message_count: Number(msgCount),
      connection_count: Number(connCount),
      error_count: Number(errCount),
      last_event_time: lastRow?.timestamp ?? null,
    };
  }

  clearQQBotLogs(category?: string): void {
    if (category) {
      this.raw.prepare("DELETE FROM qqbot_logs WHERE category = ?").run(category);
    } else {
      this.raw.prepare("DELETE FROM qqbot_logs").run();
    }
  }

  private formatHostRow(r: any) {
    let tags: string[] = [];
    try {
      tags = JSON.parse(r.tags_json || "[]");
    } catch {
      tags = [];
    }
    return {
      id: r.id,
      name: r.name,
      host: r.host,
      port: Number(r.port),
      username: r.username,
      auth_type: r.auth_type as "password" | "key",
      credential_set: Boolean(r.credential),
      proxy_url: r.proxy_url ? r.proxy_url.replace(/:\/\/([^:@]+):([^@]+)@/, "://$1:******@") : "",
      proxy_url_set: Boolean(r.proxy_url),
      default_cwd: r.default_cwd || "",
      description: r.description || "",
      tags,
      safe_mode: Boolean(r.safe_mode),
      security_mode: (r.security_mode || "ask_confirmation") as HostSecurityMode,
      status: (r.status || "inactive") as "active" | "inactive" | "error",
      os_info: r.os_info || "",
      created_at: r.created_at,
      updated_at: r.updated_at,
    };
  }

  close(): void {
    try {
      if (this.raw.isOpen) {
        this.raw.close();
      }
    } catch {
      // already closed by SqliteStorage
    }
  }
}
