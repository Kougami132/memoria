import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { MemoriaAgentRuntime } from "../agent/runtime.ts";
import type { AppDatabase } from "../db/database.ts";
import { DEFAULT_GATEWAY_INTENTS, QQGateway, type QQGatewayDeps } from "./gateway.ts";

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

/** 群聊 @ 检测：优先看 mentions 数组，回退到内容里的 <@!xxx> 标记。 */
export function hasBotMention(data: any, content: string): boolean {
  const mentions = data?.mentions;
  if (Array.isArray(mentions) && mentions.length > 0) return true;
  const text = content ?? String(data?.content ?? "");
  return /<@!?\d+>/.test(text);
}

/** 剔除官方 @ 标记（兼容 <@123> 与 <@!123> 两种写法）。 */
function stripMention(content: string): string {
  return (content ?? "").replace(/<@!?\d+>/g, "").trim();
}

export class QQBotService {
  readonly db: AppDatabase;
  readonly runtime: MemoriaAgentRuntime;
  status: "disabled" | "connecting" | "connected" | "stopped" | "error" = "disabled";
  lastError: string | null = null;
  private gateway: QQGateway | null = null;
  private readonly seenMessages = new Set<string>();
  /** 每个 QQ 会话上下文一条串行队列：同上下文串行、不同上下文并行。 */
  private readonly contextQueues = new Map<string, { pending: number; tail: Promise<void> }>();
  private senderFn?: (target: {
    contextType: "c2c" | "group";
    targetId: string;
    msgId: string;
    chunks: string[];
  }) => Promise<void>;
  private readonly gatewayDeps: QQGatewayDeps;

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
      gatewayDeps?: QQGatewayDeps;
    },
  ) {
    this.db = db;
    this.runtime = runtime;
    this.senderFn = options?.senderFn;
    this.gatewayDeps = options?.gatewayDeps ?? {};
  }

  getPolicy(): QQPolicy {
    return new QQPolicy(this.db.getQQSettings());
  }

  async reload(): Promise<void> {
    await this.stop();
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

    this.status = "connecting";
    this.lastError = null;
    this.db.logQQBotEvent({
      category: "connection",
      level: "INFO",
      eventType: "CONNECTING",
      summary: `正在连接 QQ 网关 (AppID: ${policy.appId})`,
    });

    const gateway = new QQGateway(
      {
        appId: policy.appId,
        clientSecret: policy.clientSecret,
        intents: policy.gatewayIntents || DEFAULT_GATEWAY_INTENTS,
      },
      {
        onReady: (sessionId) => {
          this.status = "connected";
          this.lastError = null;
          this.db.logQQBotEvent({
            category: "connection",
            level: "INFO",
            eventType: "READY",
            summary: `QQ 网关已连接 (AppID: ${policy.appId})`,
            details: sessionId ? `session_id=${sessionId}` : null,
          });
        },
        onEvent: (event) => this.onGatewayEvent(event),
        onDisconnect: (reason) => {
          // 断开后网关会自动重连，状态回落到 connecting，避免对外谎报在线。
          if (this.status === "connected") this.status = "connecting";
          this.lastError = reason;
          this.db.logQQBotEvent({
            category: "connection",
            level: "WARN",
            eventType: "DISCONNECTED",
            summary: `QQ 网关连接中断: ${reason.slice(0, 120)}`,
            details: reason,
          });
        },
        onFatal: (error) => {
          this.status = "error";
          this.lastError = error.message;
          this.db.logQQBotEvent({
            category: "connection",
            level: "ERROR",
            eventType: "ERROR",
            summary: error.message.slice(0, 200),
            details: error.message,
          });
        },
      },
      this.gatewayDeps,
    );
    this.gateway = gateway;
    gateway.start();
  }

  async stop(): Promise<void> {
    const gateway = this.gateway;
    this.gateway = null;
    if (gateway) await gateway.stop();
    if (this.status !== "disabled") this.status = "stopped";
  }

  /** 网关事件入口：只处理 C2C 与群 @ 消息，其余交回扩展语义。 */
  private onGatewayEvent(event: any): void {
    const type = String(event?.t ?? "");
    const data = event?.d ?? {};
    if (type !== "C2C_MESSAGE_CREATE" && type !== "GROUP_AT_MESSAGE_CREATE") return;

    const msgId = String(data.id ?? "");
    const author = data.author ?? {};
    const isC2C = type === "C2C_MESSAGE_CREATE";
    const userOpenid = String(isC2C ? author.user_openid ?? "" : author.member_openid ?? author.user_openid ?? "");
    const groupOpenid = isC2C ? undefined : String(data.group_openid ?? "");
    const content = String(data.content ?? "");

    // 按 msgId 去重（网关重连可能重放已投递事件）。
    if (!msgId || !userOpenid || (!isC2C && !groupOpenid)) return;
    if (this.seenMessages.has(msgId)) return;
    this.seenMessages.add(msgId);
    if (this.seenMessages.size > 1000) {
      this.seenMessages.delete(this.seenMessages.values().next().value as string);
    }

    const policy = this.getPolicy();
    const contextType = isC2C ? "c2c" : "group";
    const targetId = isC2C ? userOpenid : groupOpenid!;
    const convKey = this.conversationKey(contextType, targetId);

    // 群聊未 @ 机器人时不应响应（对应设置页的「群聊要求 @ 机器人」）。
    if (!isC2C && policy.groupRequireMention && !hasBotMention(data, content)) {
      this.db.logQQBotEvent({
        category: "message",
        level: "INFO",
        eventType: "MENTION_SKIPPED",
        sourceType: "group",
        sourceId: targetId,
        summary: "群消息未 @ 机器人，已忽略",
      });
      return;
    }

    const inbound: QQInboundEvent = {
      contextType,
      userOpenid,
      groupOpenid,
      userName: userOpenid,
      content,
      msgId,
    };

    // 审批命令必须带外处理：该会话的串行队列此时正被等待审批的那一轮占着，
    // 若排队会永远等不到。但白名单校验不能因此绕过。
    if (this.parseApprovalCommand(content)) {
      if (!policy.allows(contextType, userOpenid, groupOpenid)) {
        this.db.logQQBotEvent({
          category: "message",
          level: "WARN",
          eventType: "POLICY_BLOCKED",
          sourceType: contextType,
          sourceId: targetId,
          userName: userOpenid,
          summary: `拦截未授权用户的审批命令: ${userOpenid}`,
        });
        return;
      }
      void this.handleApprovalCommand(inbound).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.db.logQQBotEvent({
          category: "message",
          level: "ERROR",
          eventType: "MSG_ERROR",
          sourceType: contextType,
          sourceId: targetId,
          summary: `审批命令处理失败: ${message.slice(0, 120)}`,
          details: message,
        });
      });
      return;
    }

    const accepted = this.enqueueByContext(convKey, policy.maxQueueSize, async () => {
      await this.handleInboundMessage(inbound);
    });

    if (!accepted) {
      this.db.logQQBotEvent({
        category: "message",
        level: "WARN",
        eventType: "QUEUE_FULL",
        sourceType: contextType,
        sourceId: targetId,
        summary: `QQ 会话队列已满（上限 ${policy.maxQueueSize}），已丢弃消息`,
      });
    }
  }

  private conversationKey(contextType: "c2c" | "group", targetId: string): string {
    return `qq_${contextType}_${targetId}`;
  }

  private parseApprovalCommand(content: string): { isApprove: boolean; explicitId?: string } | null {
    // 官方网关的 @ 标记有 <@!123> 与 <@123> 两种写法，都要剔除。
    const cleaned = stripMention(content);
    const approveMatch = cleaned.match(/^(?:\/approve|批准)\s*(appr_[a-zA-Z0-9]+)?$/i);
    const rejectMatch = cleaned.match(/^(?:\/reject|拒绝)\s*(appr_[a-zA-Z0-9]+)?$/i);
    if (!approveMatch && !rejectMatch) return null;
    return {
      isApprove: Boolean(approveMatch),
      explicitId: (approveMatch?.[1] || rejectMatch?.[1])?.trim(),
    };
  }

  private async handleApprovalCommand(event: QQInboundEvent): Promise<{
    allowed: boolean;
    replies: string[];
  }> {
    const cmd = this.parseApprovalCommand(event.content);
    if (!cmd) return { allowed: true, replies: [] };

    const policy = this.getPolicy();
    const targetId = event.contextType === "group" ? event.groupOpenid || "" : event.userOpenid;
    const convKey = this.conversationKey(event.contextType, targetId);
    const manager = this.runtime.hostManager.approvalManager;
    const targetApproval = cmd.explicitId
      ? manager.getApproval(cmd.explicitId)
      : manager.listPendingApprovals().find((a) => this.approvalOwnedBy(a, convKey));

    if (!targetApproval || !this.approvalOwnedBy(targetApproval, convKey)) {
      // 群聊审批关闭要优先告知，否则 /approve <id> 会被误报成“不属于当前会话”。
      const groupApprovalOff =
        event.contextType === "group" && !policy.groupApprovalEnabled;
      const msg = groupApprovalOff
        ? "群聊审批默认关闭，请在 Web 控制台或私聊中处理该审批。"
        : targetApproval
          ? "该审批不属于当前会话，请在发起操作的原会话中确认。"
          : "当前会话没有待审批的主机指令。";
      await this.dispatchReply(event.contextType, targetId, event.msgId, [msg]);
      return { allowed: true, replies: [msg] };
    }

    manager.respond(targetApproval.id, cmd.isApprove);
    const replyText = cmd.isApprove
      ? `已批准主机 [${targetApproval.host_name}] 执行指令: \`${targetApproval.command}\``
      : `已拒绝主机 [${targetApproval.host_name}] 执行指令: \`${targetApproval.command}\``;
    await this.dispatchReply(event.contextType, targetId, event.msgId, [replyText]);
    this.db.logQQBotEvent({
      category: "message",
      level: "INFO",
      eventType: cmd.isApprove ? "APPROVAL_ACCEPTED" : "APPROVAL_REJECTED",
      sourceType: event.contextType,
      sourceId: targetId,
      userName: event.userName,
      summary: replyText,
    });
    return { allowed: true, replies: [replyText] };
  }

  /** 同上下文串行执行；超出 maxQueueSize 则拒绝。 */
  private enqueueByContext(key: string, limit: number, task: () => Promise<void>): boolean {
    const state = this.contextQueues.get(key) ?? { pending: 0, tail: Promise.resolve() };
    if (state.pending >= limit) return false;
    state.pending += 1;
    this.contextQueues.set(key, state);
    state.tail = state.tail
      .then(task)
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.db.logQQBotEvent({
          category: "message",
          level: "ERROR",
          eventType: "MSG_ERROR",
          sourceId: key,
          summary: `QQ 消息处理失败: ${message.slice(0, 120)}`,
          details: message,
        });
      })
      .finally(() => {
        state.pending -= 1;
        if (state.pending === 0 && this.contextQueues.get(key) === state) {
          this.contextQueues.delete(key);
        }
      });
    return true;
  }

  /** 只有发起该审批的同一 QQ 会话才能批准/拒绝它。 */
  private approvalOwnedBy(approval: { session_id?: string } | undefined, convKey: string): boolean {
    if (!approval?.session_id) return false;
    if (this.db.getConversation(approval.session_id)?.id !== convKey) return false;
    // 群聊审批默认关闭：群成员身份无法可靠绑定到发起人。
    if (convKey.startsWith("qq_group_") && !this.getPolicy().groupApprovalEnabled) return false;
    return true;
  }

  private async waitWithTimeout(promise: Promise<unknown>, seconds: number): Promise<"done" | "timeout"> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise.then(() => "done" as const),
        new Promise<"timeout">((resolve) => {
          timer = setTimeout(() => resolve("timeout"), Math.max(1, seconds) * 1000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
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
      // 白名单默认关闭时用户什么都收不到，会被当成“机器人不在线”。
      // 回一条带 OpenID 的提示，让用户能把标识交给管理员加白。
      if (event.contextType === "c2c" && policy.c2cEnabled) {
        const notice =
          "您暂未获得该 Bot 的访问权限。\n\n" +
          `您的身份标识 (OpenID) 为：\n${event.userOpenid}\n\n` +
          "请将此标识提供给管理员加入白名单后即可对话。";
        await this.dispatchReply(event.contextType, targetId, event.msgId, [notice]).catch(() => {});
        return { allowed: false, replies: [notice] };
      }
      if (event.contextType === "group" && policy.groupEnabled) {
        const notice =
          "本群暂未获得该 Bot 的访问权限。\n\n" +
          `群标识 (Group OpenID) 为：\n${event.groupOpenid}\n\n` +
          "请将此标识提供给管理员加入群白名单后即可使用。";
        await this.dispatchReply(event.contextType, targetId, event.msgId, [notice]).catch(() => {});
        return { allowed: false, replies: [notice] };
      }
      return { allowed: false, replies: [] };
    }

    const cleanedContent = stripMention(event.content);
    if (!cleanedContent) {
      return { allowed: true, replies: [] };
    }

    // 审批命令正常情况下已由 onGatewayEvent 带外处理；这里兼容直接调用本方法的入口。
    if (this.parseApprovalCommand(cleanedContent)) {
      return this.handleApprovalCommand(event);
    }

    // Normal Agent turn over pi-durable
    const convKey = this.conversationKey(event.contextType, targetId);
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

    const outcome = await this.waitWithTimeout(submission.wait(BACKGROUND_CONTEXT), policy.runTimeoutSeconds);
    if (outcome === "timeout") {
      await this.runtime.abortConversation(summary.id).catch(() => {});
      const msg = `处理超时（超过 ${policy.runTimeoutSeconds} 秒），任务已中止。可尝试缩小问题范围后重试。`;
      await this.dispatchReply(event.contextType, targetId, event.msgId, [msg]);
      this.db.logQQBotEvent({
        category: "message",
        level: "WARN",
        eventType: "RUN_TIMEOUT",
        sourceType: event.contextType,
        sourceId: targetId,
        summary: `QQ 会话执行超时（${policy.runTimeoutSeconds}s）`,
        durationMs: Date.now() - start,
      });
      return { allowed: true, replies: [msg] };
    }
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
      return;
    }
    const gateway = this.gateway;
    if (!gateway || this.status !== "connected") {
      // 网关未连接（如经 API 直接注入消息或连接失败）。答案已写入 replies，这里只标记未投递。
      this.db.logQQBotEvent({
        category: "message",
        level: "WARN",
        eventType: "DELIVERY_SKIPPED",
        sourceType: contextType,
        sourceId: targetId,
        summary: "QQ 网关未连接，回复未投递",
      });
      return;
    }
    for (let i = 0; i < chunks.length; i++) {
      await gateway.sendMessage({
        contextType,
        targetId,
        content: chunks[i],
        replyTo: i === 0 ? msgId : undefined,
      });
    }
  }
}
