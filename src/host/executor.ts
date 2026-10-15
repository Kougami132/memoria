import net from "node:net";
import ssh2, { type ConnectConfig } from "ssh2";
const { Client } = ssh2;
import type { HostSecurityMode } from "../../shared/types.ts";
import { DEFAULT_HOST_DANGEROUS_PATTERNS, type AppDatabase } from "../db/database.ts";
import { decryptSecret, encryptSecret } from "./crypto.ts";
import {
  CommandGuard,
  HostApprovalManager,
  resolveHostSecurityMode,
} from "./guard.ts";
import {
  createProxyTunnelSocket,
  maskProxyUrl,
  mergeProxyUrl,
  ProxyAuthError,
  ProxyServerUnreachableError,
  TargetUnreachableViaProxyError,
  validateProxyUrl,
} from "./proxy.ts";

export interface HostExecutionOutput {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type HostTransportRunner = (
  hostRecord: {
    id: string;
    name: string;
    host: string;
    port: number;
    username: string;
    auth_type: "password" | "key";
    credential: string;
    proxy_url: string;
    default_cwd: string;
  },
  command: string,
) => Promise<HostExecutionOutput>;

export async function executeSshCommand(
  host: {
    host: string;
    port: number;
    username: string;
    auth_type: "password" | "key";
    credential?: string;
    proxy_url?: string;
  },
  command: string,
  timeoutMs = 15000,
): Promise<HostExecutionOutput> {
  let sock: net.Socket | undefined;
  if (host.proxy_url) {
    sock = await createProxyTunnelSocket(host.proxy_url, host.host, host.port, Math.min(timeoutMs, 5000));
  }

  return new Promise((resolve, reject) => {
    const conn = new Client();
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      try {
        conn.end();
        conn.destroy();
      } catch {
        // ignore
      }
      if (sock && !sock.destroyed) {
        try {
          sock.destroy();
        } catch {
          // ignore
        }
      }
    };

    const done = (err: Error | null, res?: HostExecutionOutput) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (err) reject(err);
      else resolve(res!);
    };

    timer = setTimeout(() => {
      done(new Error(`SSH 操作超时 (${timeoutMs}ms)`));
    }, timeoutMs);

    conn.on("ready", () => {
      conn.exec(command, (err, stream) => {
        if (err) return done(err);
        let stdout = "";
        let stderr = "";
        stream.on("data", (data: Buffer) => {
          stdout += data.toString("utf8");
        });
        stream.stderr.on("data", (data: Buffer) => {
          stderr += data.toString("utf8");
        });
        stream.on("close", (code: number | null, signal: string | null) => {
          done(null, {
            exitCode: typeof code === "number" ? code : (signal ? 128 : 0),
            stdout,
            stderr,
          });
        });
        stream.on("error", (streamErr: Error) => {
          done(streamErr);
        });
      });
    });

    conn.on("error", (err: any) => {
      if (err?.level === "client-authentication") {
        done(new Error(`SSH 认证失败: 用户名或密码/私钥错误 (${err.message || "auth failed"})`));
      } else {
        done(err);
      }
    });

    conn.on("close", () => {
      if (!settled) {
        done(new Error("SSH 连接已关闭"));
      }
    });

    const connectConfig: ConnectConfig = {
      username: host.username || "root",
      readyTimeout: Math.min(timeoutMs, 10000),
      keepaliveInterval: 5000,
    };

    if (sock) {
      connectConfig.sock = sock;
    } else {
      connectConfig.host = host.host;
      connectConfig.port = host.port;
    }

    if (host.auth_type === "key") {
      if (host.credential) {
        connectConfig.privateKey = host.credential;
      }
    } else {
      if (host.credential) {
        connectConfig.password = host.credential;
      }
    }

    if (!host.credential && process.env.SSH_AUTH_SOCK) {
      connectConfig.agent = process.env.SSH_AUTH_SOCK;
    }

    try {
      conn.connect(connectConfig);
    } catch (err: any) {
      done(err);
    }
  });
}

export class HostManager {
  readonly db: AppDatabase;
  readonly approvalManager: HostApprovalManager;
  private customRunner?: HostTransportRunner;

  constructor(
    db: AppDatabase,
    options?: {
      approvalManager?: HostApprovalManager;
      customRunner?: HostTransportRunner;
    },
  ) {
    this.db = db;
    this.approvalManager = options?.approvalManager ?? new HostApprovalManager();
    this.customRunner = options?.customRunner;
  }

  setCustomRunner(runner: HostTransportRunner | undefined): void {
    this.customRunner = runner;
  }

  getDangerousPatterns(): string[] {
    const eff = this.db.getEffectiveSettings();
    try {
      const parsed = JSON.parse(eff.host_dangerous_patterns);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // ignore
    }
    return DEFAULT_HOST_DANGEROUS_PATTERNS;
  }

  getDecryptedHost(hostId: string) {
    const row = this.db.raw.prepare("SELECT * FROM hosts WHERE id = ?").get(hostId) as
      | Record<string, any>
      | undefined;
    if (!row) return undefined;
    let tags: string[] = [];
    try {
      tags = JSON.parse(row.tags_json || "[]");
    } catch {
      tags = [];
    }
    return {
      id: String(row.id),
      name: String(row.name),
      host: String(row.host),
      port: Number(row.port),
      username: String(row.username),
      auth_type: (row.auth_type || "password") as "password" | "key",
      credential: decryptSecret(row.credential),
      proxy_url: decryptSecret(row.proxy_url),
      default_cwd: String(row.default_cwd || ""),
      description: String(row.description || ""),
      tags,
      safe_mode: Boolean(row.safe_mode),
      security_mode: (row.security_mode || "ask_confirmation") as HostSecurityMode,
      status: (row.status || "inactive") as "active" | "inactive" | "error",
      os_info: String(row.os_info || ""),
      created_at: String(row.created_at),
      updated_at: String(row.updated_at),
    };
  }

  toPublicHost(hostRecord: ReturnType<HostManager["getDecryptedHost"]>) {
    if (!hostRecord) return undefined;
    return {
      id: hostRecord.id,
      name: hostRecord.name,
      host: hostRecord.host,
      port: hostRecord.port,
      username: hostRecord.username,
      auth_type: hostRecord.auth_type,
      credential_set: Boolean(hostRecord.credential),
      proxy_url: maskProxyUrl(hostRecord.proxy_url),
      proxy_url_set: Boolean(hostRecord.proxy_url),
      default_cwd: hostRecord.default_cwd,
      description: hostRecord.description,
      tags: hostRecord.tags,
      safe_mode: hostRecord.safe_mode,
      security_mode: hostRecord.security_mode,
      status: hostRecord.status,
      os_info: hostRecord.os_info,
      created_at: hostRecord.created_at,
      updated_at: hostRecord.updated_at,
    };
  }

  listPublicHosts() {
    const rows = this.db.raw
      .prepare("SELECT id FROM hosts ORDER BY created_at DESC")
      .all() as Array<{ id: string }>;
    return rows.map((r) => this.toPublicHost(this.getDecryptedHost(r.id))!).filter(Boolean);
  }

  createHost(input: {
    name: string;
    host: string;
    port?: number;
    username?: string;
    auth_type?: "password" | "key";
    credential?: string;
    proxy_url?: string | null;
    default_cwd?: string;
    description?: string;
    tags?: string[];
    safe_mode?: boolean;
    security_mode?: HostSecurityMode;
  }) {
    const validatedProxy = input.proxy_url ? validateProxyUrl(input.proxy_url) : "";
    const encryptedCred = input.credential ? encryptSecret(input.credential) : "";
    const encryptedProxy = validatedProxy ? encryptSecret(validatedProxy) : "";
    const secMode: HostSecurityMode =
      input.security_mode ?? (input.safe_mode ? "read_only" : "ask_confirmation");

    const created = this.db.createHost({
      name: input.name,
      host: input.host,
      port: input.port ?? 22,
      username: input.username ?? "root",
      auth_type: input.auth_type ?? "password",
      credential: encryptedCred,
      proxy_url: encryptedProxy,
      default_cwd: input.default_cwd ?? "",
      description: input.description ?? "",
      tags: input.tags ?? [],
      safe_mode: secMode === "read_only",
      security_mode: secMode,
    });
    return this.toPublicHost(this.getDecryptedHost(created.id))!;
  }

  updateHost(
    hostId: string,
    patch: {
      name?: string;
      host?: string;
      port?: number;
      username?: string;
      auth_type?: "password" | "key";
      credential?: string;
      proxy_url?: string | null;
      default_cwd?: string;
      description?: string;
      tags?: string[];
      safe_mode?: boolean;
      security_mode?: HostSecurityMode;
      status?: "active" | "inactive" | "error";
      os_info?: string;
    },
  ) {
    const existing = this.getDecryptedHost(hostId);
    if (!existing) return undefined;

    const mergedProxyPlain =
      patch.proxy_url === undefined
        ? existing.proxy_url
        : mergeProxyUrl(patch.proxy_url, existing.proxy_url);
    const encryptedProxy = mergedProxyPlain ? encryptSecret(mergedProxyPlain) : "";

    const nextCredPlain =
      patch.credential === undefined || patch.credential === "" || patch.credential === "******"
        ? existing.credential
        : patch.credential;
    const encryptedCred = nextCredPlain ? encryptSecret(nextCredPlain) : "";

    const nextSecMode: HostSecurityMode =
      patch.security_mode ??
      (patch.safe_mode !== undefined
        ? patch.safe_mode
          ? "read_only"
          : "ask_confirmation"
        : existing.security_mode);

    const now = new Date().toISOString();
    this.db.raw
      .prepare(
        `UPDATE hosts
         SET name = ?, host = ?, port = ?, username = ?, auth_type = ?, credential = ?,
             proxy_url = ?, default_cwd = ?, description = ?, tags_json = ?,
             safe_mode = ?, security_mode = ?, status = ?, os_info = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        patch.name ?? existing.name,
        patch.host ?? existing.host,
        patch.port ?? existing.port,
        patch.username ?? existing.username,
        patch.auth_type ?? existing.auth_type,
        encryptedCred,
        encryptedProxy,
        patch.default_cwd ?? existing.default_cwd,
        patch.description ?? existing.description,
        JSON.stringify(patch.tags ?? existing.tags),
        nextSecMode === "read_only" ? 1 : 0,
        nextSecMode,
        patch.status ?? existing.status,
        patch.os_info ?? existing.os_info,
        now,
        hostId,
      );

    return this.toPublicHost(this.getDecryptedHost(hostId));
  }

  async testConnection(hostId: string): Promise<{
    ok: boolean;
    status: "active" | "error";
    latency_ms: number;
    os_info?: string;
    message?: string;
  }> {
    const host = this.getDecryptedHost(hostId);
    if (!host) {
      throw new Error(`Host not found: ${hostId}`);
    }
    const start = Date.now();

    try {
      if (this.customRunner) {
        const res = await this.customRunner(host, "uname -sr");
        const latency = Math.max(1, Date.now() - start);
        if (res.exitCode === 0) {
          const osInfo = res.stdout.trim() || "Linux";
          this.updateHost(hostId, { status: "active", os_info: osInfo });
          return { ok: true, status: "active", latency_ms: latency, os_info: osInfo, message: "连接正常" };
        }
        this.updateHost(hostId, { status: "error" });
        return { ok: false, status: "error", latency_ms: latency, message: res.stderr || "SSH 命令执行失败" };
      }

      const res = await executeSshCommand(host, "uname -sr", 8000);
      const latency = Math.max(1, Date.now() - start);
      if (res.exitCode === 0) {
        const osInfo = res.stdout.trim() || "Linux";
        this.updateHost(hostId, { status: "active", os_info: osInfo });
        return {
          ok: true,
          status: "active",
          latency_ms: latency,
          os_info: osInfo,
          message: "连接成功",
        };
      }

      this.updateHost(hostId, { status: "error" });
      return {
        ok: false,
        status: "error",
        latency_ms: latency,
        message: res.stderr.trim() || res.stdout.trim() || "SSH 命令执行失败",
      };
    } catch (err: any) {
      const latency = Math.max(1, Date.now() - start);
      this.updateHost(hostId, { status: "error" });
      if (
        err instanceof ProxyServerUnreachableError ||
        err instanceof ProxyAuthError ||
        err instanceof TargetUnreachableViaProxyError
      ) {
        return {
          ok: false,
          status: "error",
          latency_ms: latency,
          message: err.message,
        };
      }
      return {
        ok: false,
        status: "error",
        latency_ms: latency,
        message: err?.message || "连接测试失败",
      };
    }
  }

  createGuardForHost(
    hostId: string,
    sessionSecurityModes?: Record<string, HostSecurityMode>,
  ): CommandGuard {
    const host = this.getDecryptedHost(hostId);
    const effectiveMode = resolveHostSecurityMode(host, sessionSecurityModes, hostId);
    return new CommandGuard({
      securityMode: effectiveMode,
      dangerousPatterns: this.getDangerousPatterns(),
    });
  }

  async runOnHost(
    hostId: string,
    command: string,
  ): Promise<{ exitCode: number; output: string }> {
    const host = this.getDecryptedHost(hostId);
    if (!host) {
      throw new Error(`Host ${hostId} not found`);
    }
    const finalCmd = host.default_cwd ? `cd ${host.default_cwd} && ${command}` : command;

    if (this.customRunner) {
      const res = await this.customRunner(host, finalCmd);
      const combined = [res.stdout, res.stderr].filter(Boolean).join("\n").trim();
      return { exitCode: res.exitCode, output: combined };
    }

    try {
      const res = await executeSshCommand(host, finalCmd);
      const combined = [res.stdout, res.stderr].filter(Boolean).join("\n").trim();
      return { exitCode: res.exitCode, output: combined };
    } catch (err: any) {
      return { exitCode: 255, output: err?.message || String(err) };
    }
  }
}
