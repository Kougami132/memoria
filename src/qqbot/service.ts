import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { MemoriaAgentRuntime } from "../agent/runtime.ts";
import type { AppDatabase } from "../db/database.ts";

export const MAX_QQ_MESSAGE_LENGTH = 4000;

export function splitMarkdown(content: string, limit = MAX_QQ_MESSAGE_LENGTH): string[] {
  if (limit <= 0) throw new Error("limit must be positive");
  if (content.length <= limit) return [content];

  const lines = content.match(/[^\n]*\n|[^\n]+/g) ?? [content];
  const chunks: string[] = [];
  let current: string[] = [];
  let inFence = false;
  let fenceMarker = "";

  const flush = () => {
    if (current.length > 0) {
      chunks.push(current.join("").replace(/\n+$/, ""));
      current = [];
    }
  };

  for (const line of lines) {
    const stripped = line.trimStart();
    const m = stripped.match(/^(`{3,}|~{3,})/);
    if (m) {
      const marker = m[1][0];
      if (!inFence) {
        inFence = true;
        fenceMarker = marker;
      } else if (marker === fenceMarker) {
        inFence = false;
      }
    }

    const curLen = current.reduce((acc, s) => acc + s.length, 0);
    if (current.length > 0 && curLen + line.length > limit) {
      if (inFence) {
        current.push(`\n${fenceMarker.repeat(3)}\n`);
        flush();
        current.push(`${fenceMarker.repeat(3)}\n`);
      } else {
        flush();
      }
    }
    current.push(line);

    while (current.reduce((acc, s) => acc + s.length, 0) > limit) {
      const text = current.join("");
      let boundary = text.lastIndexOf("\n", limit);
      if (boundary <= 0) boundary = limit;
      let part = text.slice(0, boundary).replace(/\n+$/, "");
      let remainder = text.slice(boundary).replace(/^\n+/, "");
      if (inFence) {
        part += `\n${fenceMarker.repeat(3)}`;
        remainder = `${fenceMarker.repeat(3)}\n${remainder}`;
      }
      chunks.push(part);
      current = remainder ? [remainder] : [];
    }
  }

  flush();
  return chunks.length > 0 ? chunks : [""];
}

export function markdownToPlainText(content: string): string {
  return content
    .replace(/```[^\n]*\n?/g, "")
    .replace(/```/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, g1, g2) => g1 || g2)
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s*>\s?/gm, "| ")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .trim();
}

export class QQPolicy {
  readonly enabled: boolean;
  readonly appId: string;
  readonly clientSecret: string;
  readonly gatewayIntents: number;
  readonly c2cEnabled: boolean;
  readonly groupEnabled: boolean;
  readonly groupRequireMention: boolean;
  readonly userAllowlist: Set<string>;
  readonly groupAllowlist: Set<string>;
  readonly allowUnlistedUsers: boolean;
  readonly allowUnlistedGroups: boolean;
  readonly groupApprovalEnabled: boolean;
  readonly maxQueueSize: number;
  readonly runTimeoutSeconds: number;

  constructor(settings: Record<string, string>) {
    const bool = (k: string, def = false) =>
      (settings[k] ?? String(def)).toLowerCase() === "true";
    const parseSet = (raw?: string) => {
      try {
        const arr = JSON.parse(raw || "[]");
        if (Array.isArray(arr)) {
          return new Set(arr.map((s) => String(s).trim()).filter(Boolean));
        }
      } catch {
        // ignore
      }
      return new Set<string>();
    };

    this.enabled = bool("enabled", false);
    this.appId = (settings.app_id ?? "").trim();
    this.clientSecret = settings.client_secret ?? "";
    this.gatewayIntents = Number(settings.gateway_intents || 0) || 0;
    this.c2cEnabled = bool("c2c_enabled", true);
    this.groupEnabled = bool("group_enabled", true);
    this.groupRequireMention = bool("group_require_mention", true);
    this.userAllowlist = parseSet(settings.user_allowlist);
    this.groupAllowlist = parseSet(settings.group_allowlist);
    this.allowUnlistedUsers = bool("allow_unlisted_users", false);
    this.allowUnlistedGroups = bool("allow_unlisted_groups", false);
    this.groupApprovalEnabled = bool("group_approval_enabled", false);
    this.maxQueueSize = Math.max(1, Number(settings.max_queue_size || 32) || 32);
    this.runTimeoutSeconds = Math.max(1, Number(settings.run_timeout_seconds || 300) || 300);
  }

  allows(contextType: "c2c" | "group", userOpenid: string, groupOpenid?: string): boolean {
    if (contextType === "c2c") {
      return this.c2cEnabled && (this.allowUnlistedUsers || this.userAllowlist.has(userOpenid));
    }
    if (contextType === "group") {
      return (
        this.groupEnabled &&
        (this.allowUnlistedGroups || this.groupAllowlist.has(groupOpenid || ""))
      );
    }
    return false;
  }
}

export interface QQInboundEvent {
  contextType: "c2c" | "group";
  userOpenid: string;
  groupOpenid?: string;
  userName?: string;
  content: string;
  msgId: string;
}

export class QQBotService {
  readonly db: AppDatabase;
  readonly runtime: MemoriaAgentRuntime;
  status: "disabled" | "connecting" | "connected" | "stopped" | "error" = "disabled";
  lastError: string | null = null;
  private senderFn?: (target: {
    contextType: "c2c" | "group";
    targetId: string;
    msgId: string;
    chunks: string[];
  }) => Promise<void>;

  constructor(
    db: AppDatabase,
    runtime: MemoriaAgentRuntime,
    options?: {
      senderFn?: (target: {
        contextType: "c2c" | "group";
        targetId: string;
        msgId: string;
        chunks: string[];
      }) => Promise<void>;
    },
  ) {
    this.db = db;
    this.runtime = runtime;
    this.senderFn = options?.senderFn;
  }

  getPolicy(): QQPolicy {
    return new QQPolicy(this.db.getQQSettings());
  }

  async reload(): Promise<void> {
    const policy = this.getPolicy();
    if (!policy.enabled) {
      this.status = "disabled";
      this.lastError = null;
      return;
    }
    if (!policy.appId || !policy.clientSecret) {
      this.status = "error";
      this.lastError = "QQ App ID and Client Secret are required";
      this.db.logQQBotEvent({
        category: "connection",
        level: "ERROR",
        eventType: "CONFIG_ERROR",
        summary: this.lastError,
      });
      return;
    }
    this.status = "connected";
    this.lastError = null;
    this.db.logQQBotEvent({
      category: "connection",
      level: "INFO",
      eventType: "READY",
      summary: `QQ 机器人网关已就绪 (AppID: ${policy.appId})`,
    });
  }

  async handleInboundMessage(event: QQInboundEvent): Promise<{
    allowed: boolean;
    replies: string[];
  }> {
    const start = Date.now();
    const policy = this.getPolicy();
    const targetId = event.contextType === "group" ? event.groupOpenid || "" : event.userOpenid;

    if (!policy.allows(event.contextType, event.userOpenid, event.groupOpenid)) {
      this.db.logQQBotEvent({
        category: "message",
        level: "WARN",
        eventType: "POLICY_BLOCKED",
        sourceType: event.contextType,
        sourceId: targetId,
        userName: event.userName,
        summary: `拦截未在白名单的 QQ 消息: ${event.userOpenid}`,
        durationMs: Date.now() - start,
      });
      return { allowed: false, replies: [] };
    }

    const cleanedContent = event.content.replace(/<@!\d+>/g, "").trim();
    if (!cleanedContent) {
      return { allowed: true, replies: [] };
    }

    // Check if user is responding to a pending host approval in QQ: "/approve [id]" or "/reject [id]"
    const approveMatch = cleanedContent.match(/^(?:\/approve|批准)\s*(appr_[a-zA-Z0-9]+)?$/i);
    const rejectMatch = cleanedContent.match(/^(?:\/reject|拒绝)\s*(appr_[a-zA-Z0-9]+)?$/i);
    if (approveMatch || rejectMatch) {
      const isApprove = Boolean(approveMatch);
      const explicitId = (approveMatch?.[1] || rejectMatch?.[1])?.trim();
      const pendingList = this.runtime.hostManager.approvalManager.listPendingApprovals();
      const targetApproval = explicitId
        ? this.runtime.hostManager.approvalManager.getApproval(explicitId)
        : pendingList[0];

      if (!targetApproval) {
        const msg = "当前没有待审批的主机指令。";
        await this.dispatchReply(event.contextType, targetId, event.msgId, [msg]);
        return { allowed: true, replies: [msg] };
      }

      this.runtime.hostManager.approvalManager.respond(targetApproval.id, isApprove);
      const replyText = isApprove
        ? `已批准主机 [${targetApproval.host_name}] 执行指令: \`${targetApproval.command}\``
        : `已拒绝主机 [${targetApproval.host_name}] 执行指令: \`${targetApproval.command}\``;
      await this.dispatchReply(event.contextType, targetId, event.msgId, [replyText]);
      return { allowed: true, replies: [replyText] };
    }

    // Normal Agent turn over pi-durable
    const convKey = `qq_${event.contextType}_${targetId}`;
    const allKbIds = this.db.listKBs().map((k) => k.id);
    const allHostIds = this.runtime.hostManager.listPublicHosts().map((h) => h.id);

    const { summary, submission } = await this.runtime.submitMessage({
      conversationId: convKey,
      content: cleanedContent,
      scope: {
        kbIds: allKbIds,
        hostIds: allHostIds,
      },
    });

    await submission.wait(BACKGROUND_CONTEXT);
    const msgs = (await this.runtime.getConversationMessages(summary.id)) ?? [];
    const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
    const answerText = lastAssistant?.content || "(已完成处理)";
    const chunks = splitMarkdown(answerText);

    await this.dispatchReply(event.contextType, targetId, event.msgId, chunks);

    this.db.logQQBotEvent({
      category: "message",
      level: "INFO",
      eventType: event.contextType === "group" ? "GROUP_AT_MESSAGE" : "C2C_MESSAGE",
      sourceType: event.contextType,
      sourceId: targetId,
      userName: event.userName || event.userOpenid,
      summary: `已回复 QQ 消息: ${cleanedContent.slice(0, 40)}`,
      durationMs: Date.now() - start,
      details: JSON.stringify({ prompt: cleanedContent, answer: answerText.slice(0, 200) }),
    });

    return { allowed: true, replies: chunks };
  }

  private async dispatchReply(
    contextType: "c2c" | "group",
    targetId: string,
    msgId: string,
    chunks: string[],
  ): Promise<void> {
    if (this.senderFn) {
      await this.senderFn({ contextType, targetId, msgId, chunks });
    }
  }
}
