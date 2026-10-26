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
  status: "completed" | "streaming" | "interrupted" | "failed";
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

    if (params.modelProvider || params.modelId || params.thinkingLevel || params.scope) {
      await this.configureConversation(
        summary.id,
        {
          modelProvider: params.modelProvider,
          modelId: params.modelId,
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

    const rawId = String(messageId).replace(/^msg_/, "").trim();
    const entryId = Number(rawId);
    if (Number.isNaN(entryId)) {
      return { session_id: existing.id, deleted_count: 0 };
    }

    const deletedCount = this.db.truncateConversationEntries(existing.durableId, entryId, inclusive);
    return { session_id: existing.id, deleted_count: deletedCount };
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
      status: "completed" | "streaming" | "interrupted" | "failed",
    ) => {
      const reasoningText = currentTurnReasoning.join("\n\n").trim() || null;
      const spans = [...currentTurnSpans];
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
        id: `msg_${entryId}`,
        entry_id: entryId,
        session_id: sessionId,
        role: "assistant",
        content: text,
        status,
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
            const span = {
              id: block.id || `call_${entry.id}`,
              type: "tool",
              name: block.name,
              agent_id: block.name === "delegate_subagent" ? "subagent" : "main",
              agent_name: block.name === "delegate_subagent" ? "Subagent" : "Agent",
              agent_role: block.name === "delegate_subagent" ? "specialist" : "orchestrator",
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
          if (!toolCallSpanMap.has(t.callId)) {
            currentTurnSpans.push({
              id: t.callId,
              type: "tool",
              name: t.name,
              agent_id: t.name === "delegate_subagent" ? "subagent" : "main",
              agent_name: t.name === "delegate_subagent" ? "Subagent" : "Agent",
              agent_role: t.name === "delegate_subagent" ? "specialist" : "orchestrator",
              data: {
                input: t.args,
                output: t.output,
                details: t.details,
              },
            });
          }
        }
      }
      flushAssistantTurn(Date.now(), textParts.join("\n"), "streaming");
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
