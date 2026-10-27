import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Provider } from "@earendil-works/pi-ai/models";
import {
  configure,
  createRegistry,
  Harness,
  LiveDoc,
  UsageDoc,
  watchEvents,
  type AgentEventStream,
  type Conversation,
  type ConversationId,
  type EntryId,
  type EntryRecord,
  type SubmissionId,
  type Registry,
} from "@earendil-works/pi-durable";
import type {
  ConversationScope,
  ConversationSummary,
  ThinkingLevel,
} from "../../shared/types.ts";
import { createLogger } from "../logging.ts";
import { AppDatabase, DEFAULT_SCOPE } from "../db/database.ts";
import { HostManager, type HostTransportRunner } from "../host/executor.ts";
import { QQBotService } from "../qqbot/service.ts";
import { HybridRagPipeline } from "../rag/hybrid-retriever.ts";
import { VaultManager } from "../vault/syncer.ts";
import { MemoriaScopeDoc } from "./documents.ts";
import {
  createMemoriaExtensions,
  resolveExtensionsForScope,
  type MemoriaExtensionsBundle,
} from "./extensions.ts";
import { ModelsRegistryManager } from "./models-registry.ts";

export interface FormattedMessage {
  id: string;
  entry_id: number;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  status: "completed" | "streaming" | "pending_approval" | "interrupted" | "failed";
  /** 审批挂起时携带 `approval_id` / `host_*` / `command`，供刷新或重新进入会话后恢复审批卡片。 */
  metadata?: Record<string, unknown>;
  created_at: string;
  sources: Array<{
    text: string;
    score: number;
    doc_id: string;
    kb_id?: string;
    filename?: string;
    path?: string;
    source?: string;
  }>;
  trace?: {
    trace_id: string;
    workflow_name: string;
    metadata: Record<string, unknown>;
    spans: Array<{
      id: string;
      type: string;
      name: string;
      agent_id: string;
      agent_name: string;
      agent_role: string;
      started_at?: string | null;
      ended_at?: string | null;
      duration_ms?: number | null;
      reasoning?: string | null;
      usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      } | null;
      data?: Record<string, unknown>;
      error?: unknown;
    }>;
    summary: {
      duration_ms: number | null;
      reasoning: string | null;
      span_count: number;
      tool_count: number;
      model_count: number;
      error_count: number;
      total_tokens: number;
      prompt_tokens: number;
      completion_tokens: number;
    };
  } | null;
}

export class MemoriaAgentRuntime {
  readonly db: AppDatabase;
  readonly pipeline: HybridRagPipeline;
  readonly vaultManager: VaultManager;
  readonly hostManager: HostManager;
  readonly qqBot: QQBotService;
  readonly modelsManager: ModelsRegistryManager;
  readonly registry: Registry;
  readonly extensionsBundle: MemoriaExtensionsBundle;
  readonly harness: Harness;

  private constructor(
    db: AppDatabase,
    pipeline: HybridRagPipeline,
    vaultManager: VaultManager,
    hostManager: HostManager,
    modelsManager: ModelsRegistryManager,
    registry: Registry,
    extensionsBundle: MemoriaExtensionsBundle,
    harness: Harness,
  ) {
    this.db = db;
    this.pipeline = pipeline;
    this.vaultManager = vaultManager;
    this.hostManager = hostManager;
    this.modelsManager = modelsManager;
    this.registry = registry;
    this.extensionsBundle = extensionsBundle;
    this.harness = harness;
    this.qqBot = new QQBotService(db, this);
  }

  static async create(options?: {
    db?: AppDatabase;
    dbPath?: string;
    customProviders?: Provider[];
    hostRunner?: HostTransportRunner;
    context?: Context;
  }): Promise<MemoriaAgentRuntime> {
    const context = options?.context ?? BACKGROUND_CONTEXT;
    const db = options?.db ?? new AppDatabase(options?.dbPath);
    const pipeline = new HybridRagPipeline(db);
    const vaultManager = new VaultManager(db, pipeline);
    const hostManager = new HostManager(db, { customRunner: options?.hostRunner });
    const modelsManager = new ModelsRegistryManager(db, options?.customProviders);
    const registry = createRegistry();
    const extensionsBundle = createMemoriaExtensions(db, pipeline, hostManager);
    for (const ext of extensionsBundle.all) {
      registry.install(ext);
    }

    const storage = await db.openDurableStorage();
    const harness = await Harness.open(
      storage,
      {
        models: modelsManager.models,
        registry,
        settings: {
          extensions: [extensionsBundle.base, extensionsBundle.subagent],
          progress: { partialIntervalMs: 80, outputIntervalMs: 80 },
          toolExecution: "parallel",
          contextRetentionMs: 0,
        },
        conversationCreated: async (tx, conv) => {
          const eff = db.getEffectiveSettings();
          const scopeDraft = await tx.doc(MemoriaScopeDoc, conv.id);
          scopeDraft.kbIds = [];
          scopeDraft.hostIds = [];
          scopeDraft.hostSecurityModes = {};
          scopeDraft.webSearch = eff.enable_web_search === "true";
          scopeDraft.subagentEnabled = true;
        },
      },
      context,
    );

    harness.resume();
    const eff = db.getEffectiveSettings();
    vaultManager.startPolling(Number(eff.vault_sync_interval_minutes) || 15);
    createLogger("memoria.agent.runtime").info(
      `运行时已启动 (llm=${eff.llm_model || "-"}, 同步间隔=${eff.vault_sync_interval_minutes || 15}min)`,
    );

    return new MemoriaAgentRuntime(
      db,
      pipeline,
      vaultManager,
      hostManager,
      modelsManager,
      registry,
      extensionsBundle,
      harness,
    );
  }

  async createConversation(
    params?: {
      id?: string;
      title?: string;
      channel?: "web" | "openai" | "qq";
      modelProvider?: string;
      modelId?: string;
      thinkingLevel?: ThinkingLevel;
      scope?: Partial<ConversationScope>;
    },
    context: Context = BACKGROUND_CONTEXT,
  ): Promise<{ summary: ConversationSummary; conversation: Conversation }> {
    const eff = this.db.getEffectiveSettings();
    const providerId = params?.modelProvider || eff.default_provider || "default";
    const modelId = params?.modelId || eff.llm_model;
    const thinkingLevel = params?.thinkingLevel || eff.default_thinking_level || "medium";
    const scope: ConversationScope = {
      ...DEFAULT_SCOPE,
      webSearch: eff.enable_web_search === "true",
      ...params?.scope,
    };

    this.modelsManager.ensureModelRegistered(providerId, modelId);
    const selectedExtensions = resolveExtensionsForScope(scope, this.extensionsBundle);

    const conv = await this.harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        agent: {
          model: { provider: providerId, modelId },
          thinkingLevel: thinkingLevel === "off" ? undefined : (thinkingLevel as any),
          extensions: selectedExtensions,
        },
        init: async (tx, convId) => {
          const doc = await tx.doc(MemoriaScopeDoc, convId);
          doc.kbIds = [...scope.kbIds];
          doc.hostIds = [...scope.hostIds];
          doc.hostSecurityModes = { ...scope.hostSecurityModes };
          doc.webSearch = scope.webSearch;
          doc.subagentEnabled = scope.subagentEnabled;
        },
      },
      context,
    );

    const summary = this.db.registerConversation({
      id: params?.id || String(conv.id),
      durableId: Number(conv.id),
      title: params?.title || "新对话",
      channel: params?.channel || "web",
      modelProvider: providerId,
      modelId,
      thinkingLevel,
      scope,
    });

    return { summary, conversation: conv };
  }

  async getOrCreateConversation(
    id?: string,
    context: Context = BACKGROUND_CONTEXT,
  ): Promise<{ summary: ConversationSummary; conversation: Conversation }> {
    if (id) {
      const existingMeta = this.db.getConversation(id);
      if (existingMeta) {
        const conv = await this.harness.conversation(existingMeta.durableId as ConversationId, context);
        if (conv) {
          return { summary: existingMeta, conversation: conv };
        }
      }
      return this.createConversation({ id }, context);
    }
    return this.createConversation({}, context);
  }

  async configureConversation(
    id: string,
    patch: {
      title?: string;
      modelProvider?: string;
      modelId?: string;
      thinkingLevel?: ThinkingLevel;
      scope?: Partial<ConversationScope>;
    },
    context: Context = BACKGROUND_CONTEXT,
  ): Promise<ConversationSummary | undefined> {
    const existing = this.db.getConversation(id);
    if (!existing) return undefined;

    const conv = await this.harness.conversation(existing.durableId as ConversationId, context);
    if (!conv) return undefined;

    const nextProvider = patch.modelProvider ?? existing.modelProvider;
    const nextModelId = patch.modelId ?? existing.modelId;
    const nextThinking = patch.thinkingLevel ?? existing.thinkingLevel;
    const nextScope: ConversationScope = patch.scope
      ? {
          kbIds: patch.scope.kbIds ?? existing.scope.kbIds,
          hostIds: patch.scope.hostIds ?? existing.scope.hostIds,
          hostSecurityModes: patch.scope.hostSecurityModes ?? existing.scope.hostSecurityModes,
          webSearch: patch.scope.webSearch ?? existing.scope.webSearch,
          subagentEnabled: patch.scope.subagentEnabled ?? existing.scope.subagentEnabled,
        }
      : existing.scope;

    this.modelsManager.ensureModelRegistered(nextProvider, nextModelId);
    const selectedExtensions = resolveExtensionsForScope(nextScope, this.extensionsBundle);

    await conv.commit(async (tx) => {
      const doc = await tx.doc(MemoriaScopeDoc, conv.id);
      doc.kbIds = [...nextScope.kbIds];
      doc.hostIds = [...nextScope.hostIds];
      doc.hostSecurityModes = { ...nextScope.hostSecurityModes };
      doc.webSearch = nextScope.webSearch;
      doc.subagentEnabled = nextScope.subagentEnabled;
      await configure(tx, conv.id, {
        model: { provider: nextProvider, modelId: nextModelId },
        thinkingLevel: nextThinking === "off" ? null : (nextThinking as any),
        extensions: selectedExtensions,
      });
    }, context);

    return this.db.updateConversationMeta(existing.id, {
      title: patch.title,
      modelProvider: nextProvider,
      modelId: nextModelId,
      thinkingLevel: nextThinking,
      scope: nextScope,
    });
  }

  async submitMessage(
    params: {
      conversationId?: string;
      content: string;
      whenBusy?: "steer" | "followUp" | "reject";
      requestId?: string;
      modelProvider?: string;
      modelId?: string;
      thinkingLevel?: ThinkingLevel;
      scope?: Partial<ConversationScope>;
    },
    context: Context = BACKGROUND_CONTEXT,
  ) {
    const { summary, conversation } = await this.getOrCreateConversation(params.conversationId, context);

    // 会话不固持模型：未显式指定时每次提交都重新解析当前全局默认，
    // 否则在系统设置里改了默认模型，老会话重发仍会走旧模型。
    const eff = this.db.getEffectiveSettings();
    const nextProvider = params.modelProvider || eff.default_provider || "default";
    const nextModelId = params.modelId || eff.llm_model;
    const modelChanged =
      nextProvider !== summary.modelProvider || nextModelId !== summary.modelId;

    if (modelChanged || params.thinkingLevel || params.scope) {
      await this.configureConversation(
        summary.id,
        {
          modelProvider: nextProvider,
          modelId: nextModelId,
          thinkingLevel: params.thinkingLevel,
          scope: params.scope,
        },
        context,
      );
    }

    this.db.touchConversation(summary.id, params.content.trim());

    const submission = await conversation.submit(
      {
        type: "input",
        content: params.content,
        whenBusy: params.whenBusy ?? "followUp",
        requestId: params.requestId,
      },
      context,
    );

    return {
      summary: this.db.getConversation(summary.id)!,
      conversation,
      submission,
    };
  }

  async watchConversationEvents(
    id: string,
    context: Context = BACKGROUND_CONTEXT,
  ): Promise<{ summary: ConversationSummary; stream: AgentEventStream } | undefined> {
    const existing = this.db.getConversation(id);
    if (!existing) return undefined;
    const stream = await watchEvents(this.harness, existing.durableId as ConversationId, context);
    return { summary: existing, stream };
  }

  async abortConversation(id: string, context: Context = BACKGROUND_CONTEXT): Promise<boolean> {
    const existing = this.db.getConversation(id);
    if (!existing) return false;
    const conv = await this.harness.conversation(existing.durableId as ConversationId, context);
    if (!conv) return false;
    await conv.abort(context, { background: true });
    return true;
  }

  async truncateConversation(
    id: string,
    messageId: string,
    inclusive = true,
    context: Context = BACKGROUND_CONTEXT,
  ): Promise<{ session_id: string; deleted_count: number } | undefined> {
    const existing = this.db.getConversation(id);
    if (!existing) return undefined;

    await this.abortConversation(id, context).catch(() => {});

    const rawId = String(messageId).trim();
    // Web 端的流式入口手里只有 init 事件给的 `user_<submissionId>`，没有条目 id。
    // 之前只剥 `msg_` 就 Number()，`user_1` 得到 NaN 后静默返回 deleted_count: 0，
    // 于是「停止生成」的回滚彻底失效：页面先删掉用户消息，重新拉取又把它放回来。
    const entryId = await this.resolveEntryId(existing.durableId as ConversationId, rawId, context);
    if (entryId === undefined) {
      return { session_id: existing.id, deleted_count: 0 };
    }

    const deletedCount = this.db.truncateConversationEntries(existing.durableId, entryId, inclusive);
    return { session_id: existing.id, deleted_count: deletedCount };
  }

  /** 把 `msg_<entryId>` / `user_<submissionId>` / 裸数字统一解析成条目 id。 */
  private async resolveEntryId(
    conversationId: ConversationId,
    messageId: string,
    context: Context,
  ): Promise<number | undefined> {
    const submissionMatch = /^user_(\d+)$/.exec(messageId);
    if (submissionMatch) {
      const submission = await this.harness.submission(Number(submissionMatch[1]) as SubmissionId, context);
      const record = await submission?.status(context);
      return record?.entry === undefined ? undefined : Number(record.entry);
    }
    const entryId = Number(messageId.replace(/^msg_/, ""));
    return Number.isNaN(entryId) ? undefined : entryId;
  }

  async getConversationMessages(
    id: string,
    context: Context = BACKGROUND_CONTEXT,
  ): Promise<FormattedMessage[] | undefined> {
    const existing = this.db.getConversation(id);
    if (!existing) return undefined;
    const conv = await this.harness.conversation(existing.durableId as ConversationId, context);
    if (!conv) return undefined;

    const ctxView = await conv.context(context);
    const live = await this.harness.snapshot(LiveDoc, conv.id, context);
    const usage = await this.harness.snapshot(UsageDoc, conv.id, context);

    return this.formatTranscriptToMessages(existing.id, ctxView.entries, live, usage);
  }

  formatTranscriptToMessages(
    sessionId: string,
    entries: readonly EntryRecord[],
    live: any,
    _usage: any,
  ): FormattedMessage[] {
    const messages: FormattedMessage[] = [];
    let currentTurnReasoning: string[] = [];
    let currentTurnSpans: NonNullable<FormattedMessage["trace"]>["spans"] = [];
    let currentTurnSources: FormattedMessage["sources"] = [];
    let currentTurnTokens = { prompt: 0, completion: 0, total: 0 };

    const toolCallSpanMap = new Map<string, NonNullable<FormattedMessage["trace"]>["spans"][number]>();

    // 重试期间每次失败尝试都会落一条 stopReason="error" 的助手条目；只把最后一次保留为一条失败消息。
    let pendingError: { entryId: number; message: string } | undefined;

    const flushAssistantTurn = (
      entryId: number,
      text: string,
      status: FormattedMessage["status"],
      metadata?: Record<string, unknown>,
      /** 在飞轮次没有 entry id，用稳定前缀避免与已落库的 `msg_<entryId>` 撞号。 */
      idPrefix = "msg_",
    ) => {
      const reasoningText = currentTurnReasoning.join("\n\n").trim() || null;
      const isInFlight = status === "streaming" || status === "pending_approval";
      const nowIso = new Date().toISOString();
      const spans = currentTurnSpans.map((s) =>
        !isInFlight && !s.ended_at ? { ...s, ended_at: nowIso } : s,
      );
      const sources = [...currentTurnSources];
      const trace =
        spans.length > 0 || reasoningText || currentTurnTokens.total > 0
          ? {
              trace_id: `trace_${entryId}`,
              workflow_name: "pi-durable-agent",
              metadata: {},
              spans,
              summary: {
                duration_ms: null,
                reasoning: reasoningText,
                span_count: spans.length,
                tool_count: spans.filter((s) => s.type === "tool").length,
                model_count: spans.filter((s) => s.type === "generation").length || 1,
                error_count: spans.filter((s) => Boolean(s.error)).length,
                total_tokens: currentTurnTokens.total,
                prompt_tokens: currentTurnTokens.prompt,
                completion_tokens: currentTurnTokens.completion,
              },
            }
          : null;

      messages.push({
        id: `${idPrefix}${entryId}`,
        entry_id: entryId,
        session_id: sessionId,
        role: "assistant",
        content: text,
        status,
        ...(metadata ? { metadata } : {}),
        created_at: new Date().toISOString(),
        sources,
        trace,
      });

      currentTurnReasoning = [];
      currentTurnSpans = [];
      currentTurnSources = [];
      currentTurnTokens = { prompt: 0, completion: 0, total: 0 };
      toolCallSpanMap.clear();
    };

    const flushPendingError = () => {
      if (pendingError === undefined) return;
      const { entryId, message } = pendingError;
      pendingError = undefined;
      flushAssistantTurn(entryId, message, "failed");
    };

    for (const entry of entries) {
      if (entry.kind === "pi.user") {
        flushPendingError();
        const userMsg = entry.model?.[0] as any;
        const text =
          typeof userMsg?.content === "string"
            ? userMsg.content
            : Array.isArray(userMsg?.content)
              ? userMsg.content
                  .filter((b: any) => b.type === "text")
                  .map((b: any) => b.text)
                  .join("\n")
              : "";
        messages.push({
          id: `msg_${entry.id}`,
          entry_id: Number(entry.id),
          session_id: sessionId,
          role: "user",
          content: text,
          status: "completed",
          created_at: new Date().toISOString(),
          sources: [],
          trace: null,
        });
      } else if (entry.kind === "pi.assistant") {
        const asst = entry.model?.[0] as any;
        if (!asst) continue;
        const blocks = Array.isArray(asst.content) ? asst.content : [];
        const textParts: string[] = [];
        let hasToolCalls = false;

        if (asst.stopReason === "error") {
          pendingError = {
            entryId: Number(entry.id),
            message: asst.errorMessage || "模型调用失败",
          };
          continue;
        }
        pendingError = undefined;

        if (asst.usage) {
          const inp = Number(asst.usage.input ?? 0);
          const out = Number(asst.usage.output ?? 0);
          const tot = Number(asst.usage.totalTokens ?? inp + out);
          currentTurnTokens.prompt += inp;
          currentTurnTokens.completion += out;
          currentTurnTokens.total += tot;
        }

        for (const block of blocks) {
          if (block.type === "thinking" && block.thinking) {
            currentTurnReasoning.push(block.thinking);
          } else if (block.type === "text" && block.text) {
            textParts.push(block.text);
          } else if (block.type === "toolCall") {
            hasToolCalls = true;
            const span: NonNullable<FormattedMessage["trace"]>["spans"][number] = {
              id: block.id || `call_${entry.id}`,
              type: "tool",
              name: block.name,
              agent_id: block.name === "delegate_subagent" ? "subagent" : "main",
              agent_name: block.name === "delegate_subagent" ? "Subagent" : "Agent",
              agent_role: block.name === "delegate_subagent" ? "specialist" : "orchestrator",
              started_at: typeof asst.timestamp === "number" ? new Date(asst.timestamp).toISOString() : undefined,
              data: {
                input: block.arguments,
              } as Record<string, unknown>,
            };
            currentTurnSpans.push(span);
            if (block.id) {
              toolCallSpanMap.set(block.id, span);
            }
          }
        }

        if (!hasToolCalls) {
          const stopStatus =
            asst.stopReason === "aborted"
              ? "interrupted"
              : "completed";
          flushAssistantTurn(Number(entry.id), textParts.join("\n").trim(), stopStatus);
        }
      } else if (entry.kind === "pi.tool-result") {
        const toolMsg = entry.model?.[0] as any;
        if (!toolMsg) continue;
        const outText = Array.isArray(toolMsg.content)
          ? toolMsg.content
              .filter((b: any) => b.type === "text")
              .map((b: any) => b.text)
              .join("\n")
          : "";
        const span = toolCallSpanMap.get(toolMsg.toolCallId);
        if (span && span.data) {
          span.data.output = outText;
          // 落盘了 pi.tool-result 说明该工具已执行完毕；之前没填 ended_at，
          // 前端按 `!span.ended_at && !span.error` 判定，导致所有历史成功工具永远显示「执行中」。
          span.ended_at =
            typeof toolMsg.timestamp === "number"
              ? new Date(toolMsg.timestamp).toISOString()
              : new Date().toISOString();
          if (typeof toolMsg.durationMs === "number") {
            span.duration_ms = toolMsg.durationMs;
          }
          if (toolMsg.details) {
            span.data.details = toolMsg.details;
            const maybeSources = (toolMsg.details as any)?.sources;
            if (Array.isArray(maybeSources)) {
              currentTurnSources.push(...maybeSources);
            }
          }
          if (toolMsg.isError) {
            span.error = outText || "Tool execution failed";
          }
        }
      }
    }

    // If a run is currently active in `pi.live`, append the in-flight streaming assistant message
    if (live?.run || live?.generation || (Array.isArray(live?.tools) && live.tools.length > 0)) {
      const partialMsg = live?.generation?.message;
      const blocks = Array.isArray(partialMsg?.content) ? partialMsg.content : [];
      const textParts: string[] = [];
      for (const b of blocks) {
        if (b.type === "thinking" && b.thinking) {
          currentTurnReasoning.push(b.thinking);
        } else if (b.type === "text" && b.text) {
          textParts.push(b.text);
        }
      }
      if (Array.isArray(live?.tools)) {
        for (const t of live.tools) {
          const existingSpan = toolCallSpanMap.get(t.callId);
          if (existingSpan) {
            if (existingSpan.data) {
              if (t.output !== undefined && existingSpan.data.output === undefined) {
                existingSpan.data.output = t.output;
              }
              if (t.details !== undefined && existingSpan.data.details === undefined) {
                existingSpan.data.details = t.details;
              }
            }
            if (t.status === "done" && !existingSpan.ended_at) {
              existingSpan.ended_at = new Date().toISOString();
            }
          } else {
            currentTurnSpans.push({
              id: t.callId,
              type: "tool",
              name: t.name,
              agent_id: t.name === "delegate_subagent" ? "subagent" : "main",
              agent_name: t.name === "delegate_subagent" ? "Subagent" : "Agent",
              agent_role: t.name === "delegate_subagent" ? "specialist" : "orchestrator",
              ended_at: t.status === "done" ? new Date().toISOString() : undefined,
              data: {
                input: t.args,
                output: t.output,
                details: t.details,
              },
            });
          }
        }
      }
      // 在飞消息的身份必须跨轮询保持稳定：之前用 Date.now() 当 entryId，每轮询一次 id 就变一次，
      // 前端按 id 作 key 于是每 1.5s 重建一次气泡，展开的 CoT / 轨迹被重置为收起。
      // 以本轮 run 的 submission id 作为稳定身份；同一轮里多次 flush 共享同一个 id。
      const inFlightId = Number(live?.run?.inputs?.[live.run.inputs.length - 1]) || 0;
      // 审批挂起时把 approval 写进消息，刷新或重新进入会话后才能恢复审批卡片，
      // 否则页面只剩「思考与响应中」，用户无从批准，只能等到 5 分钟审批超时。
      // 注意：只有仍处于 pending 的审批才算数；用户点过允许后 SSH 仍在跑的窗口期不能再当成待审批返回。
      // 同一轮可能并发挂起多个工具审批，全部放进 pending_approvals 一并返回，避免审批卡片逐个延迟蹦出。
      const pendingApprovalTools = Array.isArray(live?.tools)
        ? live.tools.filter((t: any) => {
            const approvalId = t?.details?.approval_id;
            if (!approvalId || t?.status === "done") return false;
            if (t?.details?.status && t.details.status !== "pending_approval") return false;
            const record = this.hostManager.approvalManager.getApproval(String(approvalId));
            return record?.status === "pending";
          })
        : [];
      const pendingApprovals = pendingApprovalTools.map((t: any) => ({
        ...(t.details as Record<string, unknown>),
        tool_call_id: t.callId,
      }));
      const firstApproval = pendingApprovals[0];
      flushAssistantTurn(
        inFlightId,
        textParts.join("\n"),
        firstApproval ? "pending_approval" : "streaming",
        firstApproval ? { ...firstApproval, pending_approvals: pendingApprovals } : undefined,
        "inflight_",
      );
    } else {
      // 重试仍在进行时不要提前宣告失败；只有这一轮彻底结束才落失败消息。
      flushPendingError();
    }

    return messages;
  }

  async close(context: Context = BACKGROUND_CONTEXT): Promise<void> {
    await this.qqBot.stop();
    await this.harness.close(context);
    this.db.close();
  }
}
