import { randomBytes, randomUUID } from "node:crypto";
import type { HostSecurityMode } from "../../shared/types.ts";
import { DEFAULT_HOST_DANGEROUS_PATTERNS } from "../db/database.ts";

export const SAFE_COMMAND_PREFIXES = [
  "cat",
  "head",
  "tail",
  "less",
  "more",
  "grep",
  "egrep",
  "fgrep",
  "awk",
  "sed",
  "ls",
  "dir",
  "pwd",
  "cd",
  "find",
  "stat",
  "file",
  "wc",
  "diff",
  "ps",
  "top",
  "htop",
  "free",
  "df",
  "du",
  "uptime",
  "uname",
  "whoami",
  "id",
  "env",
  "netstat",
  "ss",
  "ip",
  "ifconfig",
  "ping",
  "traceroute",
  "curl",
  "wget",
  "systemctl status",
  "service",
  "journalctl",
  "dmesg",
  "docker ps",
  "docker logs",
  "docker stats",
];

export const MAX_OUTPUT_CHARS = 8000;

export class CommandSafetyViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandSafetyViolation";
  }
}

export class CommandApprovalRequired extends Error {
  readonly command: string;

  constructor(message: string, command = "") {
    super(message);
    this.name = "CommandApprovalRequired";
    this.command = command;
  }
}

export class CommandGuard {
  readonly securityMode: HostSecurityMode;
  readonly safeMode: boolean;
  readonly dangerousPatterns: string[];
  readonly maxOutputChars: number;

  constructor(options?: {
    safeMode?: boolean;
    securityMode?: HostSecurityMode;
    dangerousPatterns?: string[];
    maxOutputChars?: number;
  }) {
    if (options?.securityMode) {
      this.securityMode = options.securityMode;
    } else {
      this.securityMode = options?.safeMode ? "read_only" : "ask_confirmation";
    }
    this.safeMode = this.securityMode === "read_only";
    this.dangerousPatterns = options?.dangerousPatterns ?? DEFAULT_HOST_DANGEROUS_PATTERNS;
    this.maxOutputChars = options?.maxOutputChars ?? MAX_OUTPUT_CHARS;
  }

  isSafeCommand(command: string): boolean {
    const trimmed = command.trim();
    if (!trimmed) return true;
    const subcommands = trimmed
      .split(/[|;&]/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const sc of subcommands) {
      const ok = SAFE_COMMAND_PREFIXES.some(
        (prefix) => sc === prefix || sc.startsWith(`${prefix} `) || sc.startsWith(`${prefix}\t`),
      );
      if (!ok) return false;
    }
    return true;
  }

  validateCommand(command: string, approved = false): void {
    const trimmed = command.trim();
    if (!trimmed) return;

    // 1. Hard blacklist check: blocked in ALL security modes, even if approved
    for (const pattern of this.dangerousPatterns) {
      if (!pattern) continue;
      const regex = new RegExp(pattern, "i");
      if (regex.test(trimmed)) {
        throw new CommandSafetyViolation(
          `Command execution blocked: potentially dangerous pattern detected in '${command}'`,
        );
      }
    }

    // 2. Security mode checks
    if (this.securityMode === "read_only") {
      if (!this.isSafeCommand(trimmed)) {
        throw new CommandSafetyViolation(
          `Command execution blocked in Safe Mode: '${command}' is not in the safe command whitelist`,
        );
      }
    } else if (this.securityMode === "ask_confirmation") {
      if (!this.isSafeCommand(trimmed) && !approved) {
        throw new CommandApprovalRequired(
          `Command '${command}' requires user approval before execution`,
          command,
        );
      }
    }
  }

  truncateOutput(text?: string | null): string {
    if (!text) return "";
    if (text.length <= this.maxOutputChars) return text;
    const truncated = text.slice(0, this.maxOutputChars);
    const omitted = text.length - this.maxOutputChars;
    return `${truncated}\n\n... [Output truncated: ${omitted} characters omitted] ...`;
  }
}

export function resolveHostSecurityMode(
  hostInfo: { security_mode?: HostSecurityMode; safe_mode?: boolean } | undefined,
  sessionSecurityModes: Record<string, HostSecurityMode> | undefined,
  hostId: string,
): HostSecurityMode {
  if (sessionSecurityModes && sessionSecurityModes[hostId]) {
    return sessionSecurityModes[hostId];
  }
  if (hostInfo?.security_mode) {
    return hostInfo.security_mode;
  }
  if (hostInfo?.safe_mode) {
    return "read_only";
  }
  return "ask_confirmation";
}

export interface HostApprovalRecord {
  id: string;
  host_id: string;
  host_name: string;
  command: string;
  session_id?: string;
  created_at: number;
  status: "pending" | "approved" | "rejected" | "timeout";
  authorization_token: string;
}

export class HostApprovalManager {
  readonly defaultTimeoutMs: number;
  private readonly approvals = new Map<
    string,
    {
      record: HostApprovalRecord;
      waiters: Array<(status: "approved" | "rejected" | "timeout") => void>;
    }
  >();

  constructor(defaultTimeoutMs = 300_000) {
    this.defaultTimeoutMs = defaultTimeoutMs;
  }

  createApproval(params: {
    hostId: string;
    hostName: string;
    command: string;
    sessionId?: string;
  }): HostApprovalRecord {
    const id = `appr_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const record: HostApprovalRecord = {
      id,
      host_id: params.hostId,
      host_name: params.hostName,
      command: params.command,
      session_id: params.sessionId,
      created_at: Date.now(),
      status: "pending",
      authorization_token: randomBytes(24).toString("base64url"),
    };
    this.approvals.set(id, { record, waiters: [] });
    return record;
  }

  getApproval(approvalId: string): HostApprovalRecord | undefined {
    return this.approvals.get(approvalId)?.record;
  }

  listPendingApprovals(sessionId?: string): HostApprovalRecord[] {
    const out: HostApprovalRecord[] = [];
    for (const { record } of this.approvals.values()) {
      if (record.status !== "pending") continue;
      if (sessionId && record.session_id && record.session_id !== sessionId) continue;
      out.push(record);
    }
    return out;
  }

  respond(approvalId: string, approved: boolean): HostApprovalRecord | undefined {
    const entry = this.approvals.get(approvalId);
    if (!entry) return undefined;
    if (entry.record.status === "pending") {
      entry.record.status = approved ? "approved" : "rejected";
      for (const resolve of entry.waiters.splice(0)) {
        resolve(entry.record.status);
      }
    }
    return entry.record;
  }

  async waitForDecision(
    approvalId: string,
    signal?: AbortSignal,
    timeoutMs = this.defaultTimeoutMs,
  ): Promise<"approved" | "rejected" | "timeout"> {
    const entry = this.approvals.get(approvalId);
    if (!entry) return "rejected";
    if (entry.record.status !== "pending") {
      return entry.record.status;
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (entry.record.status === "pending") {
          entry.record.status = "timeout";
        }
        cleanup();
        resolve("timeout");
      }, timeoutMs);

      const onAbort = () => {
        if (entry.record.status === "pending") {
          entry.record.status = "rejected";
        }
        cleanup();
        resolve("rejected");
      };

      const waiter = (status: "approved" | "rejected" | "timeout") => {
        cleanup();
        resolve(status);
      };

      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        const idx = entry.waiters.indexOf(waiter);
        if (idx >= 0) entry.waiters.splice(idx, 1);
      };

      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
      entry.waiters.push(waiter);
    });
  }
}
