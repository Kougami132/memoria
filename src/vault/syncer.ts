import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import type { AppDatabase } from "../db/database.ts";
import { createLogger } from "../logging.ts";
import type { HybridRagPipeline } from "../rag/hybrid-retriever.ts";
import { SUPPORTED_EXTENSIONS } from "../rag/parser.ts";

const log = createLogger("memoria.vault.syncer");

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function nowIso(): string {
  return new Date().toISOString();
}

export interface VaultConnector {
  listFiles(): Promise<string[]>;
  readFile(relPath: string): Promise<Buffer>;
}

export class LocalVaultConnector implements VaultConnector {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async listFiles(): Promise<string[]> {
    if (!existsSync(this.root) || !statSync(this.root).isDirectory()) {
      throw new Error(`Vault path not found: ${this.root}`);
    }
    const result: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith(".")) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile()) {
          const ext = extname(entry.name).toLowerCase();
          if (SUPPORTED_EXTENSIONS.has(ext)) {
            const rel = relative(this.root, full).replace(/\\/g, "/");
            result.push(rel);
          }
        }
      }
    };
    walk(this.root);
    return result.sort();
  }

  async readFile(relPath: string): Promise<Buffer> {
    const full = join(this.root, relPath);
    return readFileSync(full);
  }
}

export function normalizeWebdavPath(path?: string | null): string {
  let cleaned = (path || "/").trim().replace(/\\/g, "/") || "/";
  if (!cleaned.startsWith("/")) cleaned = `/${cleaned}`;
  cleaned = cleaned.replace(/\/+/g, "/");
  if (cleaned.length > 1) cleaned = cleaned.replace(/\/+$/, "");
  return cleaned;
}

export class WebDAVVaultConnector implements VaultConnector {
  readonly baseUrl: string;
  readonly rootPath: string;
  private readonly authHeader?: string;

  constructor(url: string, username?: string | null, password?: string | null, rootPath?: string | null) {
    this.baseUrl = url.replace(/\/+$/, "");
    this.rootPath = normalizeWebdavPath(rootPath);
    if (username) {
      const token = Buffer.from(`${username}:${password ?? ""}`).toString("base64");
      this.authHeader = `Basic ${token}`;
    }
  }

  private buildHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
      ...(this.authHeader ? { Authorization: this.authHeader } : {}),
      ...extra,
    };
  }

  private buildTargetUrl(subPath = ""): string {
    const cleanSub = subPath.replace(/^\/+/, "");
    const rootPart = this.rootPath === "/" ? "" : this.rootPath;
    return cleanSub ? `${this.baseUrl}${rootPart}/${cleanSub}` : `${this.baseUrl}${rootPart}/`;
  }

  async listFiles(): Promise<string[]> {
    const resp = await fetch(this.buildTargetUrl(), {
      method: "PROPFIND",
      headers: this.buildHeaders({ Depth: "infinity" }),
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) {
      throw new Error(`WebDAV PROPFIND failed: HTTP ${resp.status}`);
    }
    const xml = await resp.text();
    const responses = xml.match(/<(?:d:|D:)?response\b[\s\S]*?<\/(?:d:|D:)?response>/g) ?? [];
    const basePathname = new URL(this.buildTargetUrl()).pathname.replace(/\/+$/, "");
    const files: string[] = [];

    for (const block of responses) {
      const isCollection = /<(?:d:|D:)?collection\s*\/?>/i.test(block);
      if (isCollection) continue;
      const hrefMatch = block.match(/<(?:d:|D:)?href[^>]*>([\s\S]*?)<\/(?:d:|D:)?href>/i);
      if (!hrefMatch) continue;
      const decodedHref = decodeURIComponent(hrefMatch[1].trim());
      let rel = decodedHref;
      if (basePathname && rel.startsWith(basePathname)) {
        rel = rel.slice(basePathname.length);
      }
      rel = rel.replace(/^\/+/, "").replace(/\/+$/, "");
      if (!rel) continue;
      const ext = extname(rel).toLowerCase();
      if (SUPPORTED_EXTENSIONS.has(ext)) {
        files.push(rel);
      }
    }
    return files.sort();
  }

  async listDirs(browsePath = "/"): Promise<string[]> {
    const normBrowse = normalizeWebdavPath(browsePath);
    const targetUrl =
      normBrowse === "/" ? `${this.baseUrl}/` : `${this.baseUrl}${normBrowse}/`;
    const resp = await fetch(targetUrl, {
      method: "PROPFIND",
      headers: this.buildHeaders({ Depth: "1" }),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) {
      throw new Error(`WebDAV PROPFIND failed: HTTP ${resp.status}`);
    }
    const xml = await resp.text();
    const responses = xml.match(/<(?:d:|D:)?response\b[\s\S]*?<\/(?:d:|D:)?response>/g) ?? [];
    const basePathname = new URL(this.baseUrl).pathname.replace(/\/+$/, "");
    const dirs: string[] = [];

    for (const block of responses) {
      const isCollection = /<(?:d:|D:)?collection\s*\/?>/i.test(block);
      if (!isCollection) continue;
      const hrefMatch = block.match(/<(?:d:|D:)?href[^>]*>([\s\S]*?)<\/(?:d:|D:)?href>/i);
      if (!hrefMatch) continue;
      let pathPart = decodeURIComponent(hrefMatch[1].trim());
      try {
        if (pathPart.startsWith("http://") || pathPart.startsWith("https://")) {
          pathPart = new URL(pathPart).pathname;
        }
      } catch {
        // ignore URL parse error
      }
      if (basePathname && pathPart.startsWith(basePathname)) {
        pathPart = pathPart.slice(basePathname.length);
      }
      const normDir = normalizeWebdavPath(pathPart);
      if (normDir !== normBrowse) {
        dirs.push(normDir);
      }
    }
    return Array.from(new Set(dirs)).sort();
  }

  async readFile(relPath: string): Promise<Buffer> {
    const resp = await fetch(this.buildTargetUrl(relPath), {
      method: "GET",
      headers: this.buildHeaders(),
      signal: AbortSignal.timeout(20000),
    });
    if (!resp.ok) {
      throw new Error(`WebDAV GET ${relPath} failed: HTTP ${resp.status}`);
    }
    const arr = await resp.arrayBuffer();
    return Buffer.from(arr);
  }
}

export function browseLocalPath(inputPath?: string | null) {
  const start = inputPath?.trim() ? resolve(inputPath.trim()) : homedir();
  if (!existsSync(start)) {
    throw new Error(`Local path not found: ${start}`);
  }
  const current = statSync(start).isDirectory() ? start : dirname(start);
  const entries: Array<{ name: string; path: string; type: "directory" }> = [];
  for (const item of readdirSync(current, { withFileTypes: true })) {
    if (item.isDirectory() && !item.name.startsWith(".")) {
      entries.push({
        name: item.name,
        path: join(current, item.name),
        type: "directory",
      });
    }
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  const parentDir = dirname(current);
  return {
    path: current,
    parent: parentDir !== current ? parentDir : null,
    entries,
  };
}

export class VaultManager {
  readonly db: AppDatabase;
  readonly pipeline: HybridRagPipeline;
  private readonly cancelControllers = new Map<string, AbortController>();
  private pollingTimer?: NodeJS.Timeout;
  private pollingIntervalMinutes: number = 15;
  private isPollingActive: boolean = false;
  private lastPollAt?: string;

  constructor(db: AppDatabase, pipeline: HybridRagPipeline) {
    this.db = db;
    this.pipeline = pipeline;
  }

  startPolling(intervalMinutes?: number): void {
    if (intervalMinutes && intervalMinutes > 0) {
      this.pollingIntervalMinutes = intervalMinutes;
    }
    this.stopPolling();
    const intervalMs = Math.max(1, this.pollingIntervalMinutes) * 60 * 1000;
    this.pollingTimer = setInterval(() => {
      void this.runPollCycle().catch((err) => {
        log.error(`Vault 轮询周期未捕获异常: ${err instanceof Error ? err.message : String(err)}`);
      });
    }, intervalMs);
    // Don't keep the Node.js event loop alive if everything else exits
    this.pollingTimer.unref();
  }

  stopPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = undefined;
    }
  }

  setPollingInterval(minutes: number): void {
    const validMinutes = Math.max(1, Number(minutes) || 15);
    this.pollingIntervalMinutes = validMinutes;
    if (this.pollingTimer) {
      this.startPolling(validMinutes);
    }
  }

  getSchedulerStatus(): {
    running: boolean;
    intervalMinutes: number;
    isPollingActive: boolean;
    lastPollAt?: string;
    autoSyncVaultCount: number;
  } {
    const row = this.db.raw
      .prepare("SELECT COUNT(*) as count FROM vaults WHERE auto_sync = 1")
      .get() as { count: number } | undefined;
    return {
      running: Boolean(this.pollingTimer),
      intervalMinutes: this.pollingIntervalMinutes,
      isPollingActive: this.isPollingActive,
      lastPollAt: this.lastPollAt,
      autoSyncVaultCount: Number(row?.count || 0),
    };
  }

  async runPollCycle(): Promise<void> {
    if (this.isPollingActive) {
      return;
    }
    this.isPollingActive = true;
    try {
      const candidates = this.db.raw
        .prepare("SELECT kb_id, id FROM vaults WHERE auto_sync = 1 AND syncing = 0")
        .all() as Array<{ kb_id: string; id: string }>;

      for (const item of candidates) {
        try {
          await this.syncVault(item.kb_id);
        } catch (err) {
          log.warn(
            `Vault 同步失败 vault=${item.id} kb=${item.kb_id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      this.lastPollAt = nowIso();
    } finally {
      this.isPollingActive = false;
    }
  }

  getVaultByKb(kbId: string, includeSecret = false): Record<string, any> | undefined {
    const row = this.db.raw
      .prepare("SELECT * FROM vaults WHERE kb_id = ?")
      .get(kbId) as Record<string, any> | undefined;
    if (!row) return undefined;
    return this.formatVaultRow(row, includeSecret);
  }

  getVaultById(vaultId: string, includeSecret = false): Record<string, any> | undefined {
    const row = this.db.raw
      .prepare("SELECT * FROM vaults WHERE id = ?")
      .get(vaultId) as Record<string, any> | undefined;
    if (!row) return undefined;
    return this.formatVaultRow(row, includeSecret);
  }

  createVault(
    kbId: string,
    input: {
      type: "local" | "webdav";
      local_path?: string;
      webdav_url?: string;
      webdav_path?: string;
      webdav_username?: string;
      webdav_password?: string;
      auto_sync?: boolean;
    },
  ) {
    const id = `vault_${randomUUID().slice(0, 8)}`;
    const now = nowIso();
    this.db.raw
      .prepare(
        `INSERT INTO vaults (
          id, kb_id, type, local_path, webdav_url, webdav_path, webdav_username, webdav_password,
          last_synced_at, syncing, auto_sync, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?)`,
      )
      .run(
        id,
        kbId,
        input.type,
        input.local_path ?? null,
        input.webdav_url ?? null,
        normalizeWebdavPath(input.webdav_path),
        input.webdav_username ?? null,
        input.webdav_password ?? null,
        input.auto_sync === false ? 0 : 1,
        now,
      );
    return this.getVaultByKb(kbId)!;
  }

  updateVault(
    kbId: string,
    patch: {
      auto_sync?: boolean;
      type?: "local" | "webdav";
      local_path?: string;
      webdav_url?: string;
      webdav_path?: string;
      webdav_username?: string;
      webdav_password?: string;
    },
  ) {
    const existing = this.getVaultByKb(kbId, true);
    if (!existing) return undefined;
    const nextType = patch.type ?? existing.type;
    const nextLocal = patch.local_path !== undefined ? patch.local_path : existing.local_path;
    const nextUrl = patch.webdav_url !== undefined ? patch.webdav_url : existing.webdav_url;
    const nextPath =
      patch.webdav_path !== undefined ? normalizeWebdavPath(patch.webdav_path) : existing.webdav_path;
    const nextUser =
      patch.webdav_username !== undefined ? patch.webdav_username : existing.webdav_username;
    const nextPass =
      patch.webdav_password !== undefined && patch.webdav_password !== ""
        ? patch.webdav_password
        : existing.webdav_password;
    const nextAutoSync = patch.auto_sync !== undefined ? (patch.auto_sync ? 1 : 0) : existing.auto_sync ? 1 : 0;

    this.db.raw
      .prepare(
        `UPDATE vaults
         SET type = ?, local_path = ?, webdav_url = ?, webdav_path = ?, webdav_username = ?, webdav_password = ?, auto_sync = ?
         WHERE kb_id = ?`,
      )
      .run(nextType, nextLocal, nextUrl, nextPath, nextUser, nextPass, nextAutoSync, kbId);
    return this.getVaultByKb(kbId);
  }

  deleteVault(kbId: string): boolean {
    const existing = this.getVaultByKb(kbId, true);
    if (!existing) return false;
    this.cancelSync(kbId);
    const tracked = this.listVaultFiles(existing.id);
    for (const vf of tracked) {
      this.pipeline.deleteDoc(vf.doc_id);
    }
    this.db.raw.prepare("DELETE FROM vaults WHERE kb_id = ?").run(kbId);
    return true;
  }

  listVaultFiles(vaultId: string) {
    return this.db.raw
      .prepare("SELECT * FROM vault_files WHERE vault_id = ?")
      .all(vaultId) as Array<{
      id: string;
      vault_id: string;
      kb_id: string;
      doc_id: string;
      rel_path: string;
      file_hash: string;
      mtime_ms: number;
      synced_at: string;
    }>;
  }

  cancelSync(kbId: string): boolean {
    const existing = this.getVaultByKb(kbId, true);
    if (!existing) return false;
    const ctrl = this.cancelControllers.get(existing.id);
    if (ctrl) {
      ctrl.abort();
      this.cancelControllers.delete(existing.id);
    }
    this.db.raw.prepare("UPDATE vaults SET syncing = 0 WHERE id = ?").run(existing.id);
    return true;
  }

  async syncVault(kbId: string): Promise<boolean> {
    const vault = this.getVaultByKb(kbId, true);
    if (!vault) return false;

    const controller = new AbortController();
    this.cancelControllers.set(vault.id, controller);
    this.db.raw.prepare("UPDATE vaults SET syncing = 1 WHERE id = ?").run(vault.id);

    try {
      const connector: VaultConnector =
        vault.type === "local"
          ? new LocalVaultConnector(vault.local_path)
          : new WebDAVVaultConnector(
              vault.webdav_url,
              vault.webdav_username,
              vault.webdav_password,
              vault.webdav_path,
            );

      const currentList = await connector.listFiles();
      const currentSet = new Set(currentList);
      const trackedRows = this.listVaultFiles(vault.id);
      const trackedMap = new Map(trackedRows.map((r) => [r.rel_path, r]));

      // Safety guard: prevent accidental wipe if remote/mount returns 0 files when >=3 existed
      if (trackedRows.length >= 3 && currentSet.size === 0) {
        return false;
      }

      // 1. Delete removed files
      for (const [relPath, row] of trackedMap.entries()) {
        if (!currentSet.has(relPath)) {
          this.pipeline.deleteDoc(row.doc_id);
          this.db.raw.prepare("DELETE FROM vault_files WHERE id = ?").run(row.id);
        }
      }

      // 2. Ingest new or modified files
      for (const relPath of currentList) {
        if (controller.signal.aborted) {
          return false;
        }
        const buf = await connector.readFile(relPath);
        const hash = sha256(buf);
        const existingRow = trackedMap.get(relPath);

        if (!existingRow) {
          const ingested = await this.pipeline.ingest({
            kbId: vault.kb_id,
            filename: basename(relPath),
            contentBuffer: buf,
            path: relPath,
            source: "vault",
          });
          this.db.raw
            .prepare(
              `INSERT INTO vault_files (id, vault_id, kb_id, doc_id, rel_path, file_hash, mtime_ms, synced_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              `vf_${randomUUID().slice(0, 8)}`,
              vault.id,
              vault.kb_id,
              ingested.doc_id,
              relPath,
              hash,
              Date.now(),
              nowIso(),
            );
        } else if (existingRow.file_hash !== hash) {
          this.pipeline.deleteDoc(existingRow.doc_id);
          const ingested = await this.pipeline.ingest({
            kbId: vault.kb_id,
            filename: basename(relPath),
            contentBuffer: buf,
            path: relPath,
            source: "vault",
          });
          this.db.raw
            .prepare(
              `UPDATE vault_files SET doc_id = ?, file_hash = ?, mtime_ms = ?, synced_at = ? WHERE id = ?`,
            )
            .run(ingested.doc_id, hash, Date.now(), nowIso(), existingRow.id);
        }
      }

      this.db.raw
        .prepare("UPDATE vaults SET last_synced_at = ? WHERE id = ?")
        .run(nowIso(), vault.id);
      return true;
    } finally {
      this.cancelControllers.delete(vault.id);
      this.db.raw.prepare("UPDATE vaults SET syncing = 0 WHERE id = ?").run(vault.id);
    }
  }

  private formatVaultRow(row: Record<string, any>, includeSecret = false) {
    const out: Record<string, any> = {
      id: row.id,
      kb_id: row.kb_id,
      type: row.type as "local" | "webdav",
      local_path: row.local_path ?? undefined,
      webdav_url: row.webdav_url ?? undefined,
      webdav_path: row.webdav_path ?? undefined,
      webdav_username: row.webdav_username ?? undefined,
      last_synced_at: row.last_synced_at ?? null,
      syncing: Boolean(row.syncing),
      auto_sync: Boolean(row.auto_sync),
      created_at: row.created_at,
    };
    if (includeSecret) {
      out.webdav_password = row.webdav_password ?? "";
    }
    return out;
  }
}
