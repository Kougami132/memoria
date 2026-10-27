import { Type } from "@earendil-works/pi-ai";
import {
  AssistantEntry,
  configure,
  defineExtension,
  defineTool,
  section,
  type Extension,
} from "@earendil-works/pi-durable";
import type { ConversationScope } from "../../shared/types.ts";
import type { AppDatabase } from "../db/database.ts";
import type { HostManager } from "../host/executor.ts";
import { CommandApprovalRequired, CommandSafetyViolation } from "../host/guard.ts";
import type { HybridRagPipeline } from "../rag/hybrid-retriever.ts";
import { MemoriaScopeDoc } from "./documents.ts";
import { executeWebSearch, fetchWebPage } from "./web-search.ts";

export interface MemoriaExtensionsBundle {
  base: Extension;
  knowledge: Extension;
  host: Extension;
  web: Extension;
  subagent: Extension;
  all: Extension[];
}

export function resolveToolAgentMeta(toolName: string): {
  agent_id: string;
  agent_name: string;
  agent_role: "orchestrator" | "specialist";
} {
  if (toolName === "delegate_subagent") {
    return { agent_id: "subagent", agent_name: "Subagent", agent_role: "specialist" };
  }
  if (
    toolName === "kb_search" ||
    toolName === "kb_read" ||
    toolName === "list_knowledge_bases" ||
    toolName === "search_knowledge_base" ||
    toolName === "read_knowledge_document" ||
    toolName === "delegate_to_knowledge_agent"
  ) {
    return { agent_id: "knowledge_agent", agent_name: "KnowledgeAgent", agent_role: "specialist" };
  }
  if (
    toolName === "host_exec" ||
    toolName === "host_read_log" ||
    toolName === "list_hosts" ||
    toolName === "get_host_info" ||
    toolName === "run_host_command" ||
    toolName === "read_host_log_tail" ||
    toolName === "delegate_to_host_agent"
  ) {
    return { agent_id: "host_agent", agent_name: "HostAgent", agent_role: "specialist" };
  }
  if (
    toolName === "web_search" ||
    toolName === "web_fetch" ||
    toolName === "delegate_to_web_agent"
  ) {
    return { agent_id: "web_agent", agent_name: "WebAgent", agent_role: "specialist" };
  }
  return { agent_id: "main", agent_name: "Agent", agent_role: "orchestrator" };
}

function collectSubagentTrace(entries: readonly any[], parentCallId: string) {
  const sources: any[] = [];
  const spans: any[] = [];
  const toolSpanMap = new Map<string, any>();
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;

  for (const entry of entries) {
    if (entry.kind === "pi.assistant") {
      const asst = entry.model?.[0];
      if (!asst || asst.stopReason === "error") continue;
      const inp = Number(asst.usage?.input ?? 0);
      const out = Number(asst.usage?.output ?? 0);
      const tot = Number(asst.usage?.totalTokens ?? inp + out);
      const genUsage =
        inp > 0 || out > 0 || tot > 0
          ? { prompt_tokens: inp, completion_tokens: out, total_tokens: tot }
          : null;
      if (genUsage) {
        promptTokens += inp;
        completionTokens += out;
        totalTokens += tot;
      }

      const blocks = Array.isArray(asst.content) ? asst.content : [];
      const thinkingParts: string[] = [];
      const textParts: string[] = [];
      const toolCalls: any[] = [];
      for (const b of blocks) {
        if (b.type === "thinking" && b.thinking) thinkingParts.push(b.thinking);
        else if (b.type === "text" && b.text) textParts.push(b.text);
        else if (b.type === "toolCall") toolCalls.push(b);
      }

      const startedMs = typeof asst.timestamp === "number" ? asst.timestamp : undefined;
      const durationMs = typeof asst.durationMs === "number" ? asst.durationMs : null;
      const endedMs =
        startedMs !== undefined ? startedMs + (durationMs !== null ? durationMs : 0) : undefined;
      const thought = thinkingParts.join("\n\n").trim();
      const content = textParts.join("\n").trim();
      const genOutput: Record<string, unknown> = {};
      if (thought) genOutput.thought = thought;
      if (toolCalls.length > 0) {
        genOutput.tool_calls = toolCalls.map((tc) => ({
          id: tc.id,
          name: tc.name,
          arguments: tc.arguments,
        }));
      }
      if (content) genOutput.content = content;
      if (genUsage) genOutput.usage = genUsage;

      spans.push({
        id: `sub_gen_${entry.id}`,
        parent_id: parentCallId,
        type: "generation",
        name: asst.model || "llm",
        agent_id: "subagent",
        agent_name: "Subagent",
        agent_role: "specialist",
        started_at: startedMs !== undefined ? new Date(startedMs).toISOString() : undefined,
        ended_at: endedMs !== undefined ? new Date(endedMs).toISOString() : new Date().toISOString(),
        duration_ms: durationMs,
        reasoning: thought || null,
        usage: genUsage,
        data: {
          output: Object.keys(genOutput).length > 0 ? genOutput : content || null,
        },
      });

      for (const tc of toolCalls) {
        const roleMeta = resolveToolAgentMeta(tc.name);
        const toolSpan = {
          id: tc.id || `sub_call_${entry.id}`,
          parent_id: parentCallId,
          type: "tool",
          name: tc.name,
          agent_id: roleMeta.agent_id,
          agent_name: roleMeta.agent_name,
          agent_role: roleMeta.agent_role,
          started_at: endedMs !== undefined ? new Date(endedMs).toISOString() : undefined,
          data: { input: tc.arguments } as Record<string, unknown>,
        };
        spans.push(toolSpan);
        if (tc.id) toolSpanMap.set(tc.id, toolSpan);
      }
    } else if (entry.kind === "pi.tool-result") {
      const toolMsg = entry.model?.[0];
      if (!toolMsg) continue;
      const outText = Array.isArray(toolMsg.content)
        ? toolMsg.content
            .filter((b: any) => b.type === "text")
            .map((b: any) => b.text)
            .join("\n")
        : "";
      const span = toolSpanMap.get(toolMsg.toolCallId);
      if (span) {
        span.data.output = outText;
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
            sources.push(...maybeSources);
          }
        }
        if (toolMsg.isError) {
          span.error = outText || "Tool execution failed";
        }
      }
    }
  }

  const usage =
    promptTokens > 0 || completionTokens > 0 || totalTokens > 0
      ? { prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: totalTokens }
      : null;

  return { sources, spans, usage };
}

function extractAssistantText(entryRecord: { model?: readonly any[] } | undefined): string {
  const msg = entryRecord?.model?.[0];
  if (!msg || !Array.isArray(msg.content)) return "";
  return msg.content
    .filter((b: any) => b.type === "text" && typeof b.text === "string")
    .map((b: any) => b.text)
    .join("\n")
    .trim();
}

export function createMemoriaExtensions(
  db: AppDatabase,
  pipeline: HybridRagPipeline,
  hostManager: HostManager,
): MemoriaExtensionsBundle {
  const base = defineExtension({
    name: "memoria-base",
    sections: [
      section(
        "system_instructions",
        () => {
          const eff = db.getEffectiveSettings();
          return eff.system_prompt;
        },
        { tag: false },
      ),
    ],
  });

  const knowledge = defineExtension({
    name: "knowledge",
    sections: [
      section("knowledge_bases", async (input, context) => {
        const scope = await input.read.snapshot(MemoriaScopeDoc, input.conversationId, context);
        const kbIds = scope?.kbIds ?? [];
        if (kbIds.length === 0) return undefined;
        const allKbs = db.listKBs().filter((kb) => kbIds.includes(kb.id));
        if (allKbs.length === 0) return undefined;
        const lines = allKbs.map(
          (kb) => `- [${kb.id}] ${kb.name}${kb.description ? `: ${kb.description}` : ""} (type=${kb.type})`,
        );
        return `当前会话已挂载以下知识库，可使用 kb_search (向量+BM25混合检索) 与 kb_read (全文阅读) 检索资料：\n${lines.join("\n")}`;
      }),
    ],
    tools: [
      defineTool({
        name: "kb_search",
        description: "在当前会话已启用的知识库中执行向量与 FTS5 BM25 混合检索 (RRF 融合)，返回高相关片段",
        parameters: Type.Object({
          query: Type.String({ description: "检索关键词或语义问题" }),
          kb_id: Type.Optional(Type.String({ description: "可选限定特定知识库 ID" })),
          top_k: Type.Optional(Type.Number({ description: "返回条数，默认 5" })),
        }),
        replay: "safe",
        execute: async (args, api, context) => {
          const scope = await api.snapshot(MemoriaScopeDoc, api.conversationId, context);
          const allowedKbs = scope?.kbIds ?? [];
          if (allowedKbs.length === 0) {
            return {
              content: [{ type: "text", text: "当前会话未挂载任何知识库。" }],
              isError: true,
            };
          }
          const targetKbs = args.kb_id
            ? allowedKbs.filter((id) => id === args.kb_id)
            : allowedKbs;
          if (targetKbs.length === 0) {
            return {
              content: [{ type: "text", text: `知识库 ${args.kb_id} 未在当前会话启用。` }],
              isError: true,
            };
          }

          const { chunks: hits, degradedReason } = await pipeline.retrieveDetailed({
            kbIds: targetKbs,
            query: args.query,
            topK: args.top_k,
          });

          const sources = hits.map((r) => ({
            text: r.text,
            score: r.score,
            doc_id: r.doc_id,
            kb_id: r.kb_id,
            filename: r.filename,
            path: r.path ?? null,
            source: r.source,
          }));
          await api.details({ sources, degraded_reason: degradedReason ?? null }, context);

          // 降级时必须告知模型：关键词检索的召回范围比向量检索窄，避免其过度断言。
          const degradedNote = degradedReason
            ? `⚠️ 向量检索不可用（${degradedReason}），本次结果仅来自关键词（BM25）匹配，召回可能不完整。若未找到相关内容，请告知用户知识库检索已降级，不要自行推测。\n\n`
            : "";

          if (hits.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: degradedNote
                    ? `${degradedNote}未找到与 "${args.query}" 相关的知识库片段。`
                    : `未找到与 "${args.query}" 相关的知识库片段。`,
                },
              ],
            };
          }

          const formatted =
            degradedNote +
            hits
              .map(
                (r, i) =>
                  `[#${i + 1}] (${r.filename}, score=${r.score}, doc_id=${r.doc_id}, kb_id=${r.kb_id}):\n${r.text}`,
              )
              .join("\n\n---\n\n");
          return {
            content: [{ type: "text", text: formatted }],
          };
        },
      }),
      defineTool({
        name: "kb_read",
        description: "读取当前会话已启用知识库中指定文档的全文或片段内容（防切片截断）",
        parameters: Type.Object({
          doc_id: Type.String({ description: "文档 ID" }),
          max_chars: Type.Optional(Type.Number({ description: "最大读取字符数，默认 4000" })),
        }),
        replay: "safe",
        execute: async (args, api, context) => {
          const scope = await api.snapshot(MemoriaScopeDoc, api.conversationId, context);
          const allowedKbs = new Set(scope?.kbIds ?? []);
          const doc = db.raw
            .prepare("SELECT id, kb_id, filename, content FROM kb_documents WHERE id = ?")
            .get(args.doc_id) as { id: string; kb_id: string; filename: string; content: string } | undefined;
          if (!doc || !allowedKbs.has(doc.kb_id)) {
            return {
              content: [{ type: "text", text: `文档 ${args.doc_id} 不存在或未在当前会话授权。` }],
              isError: true,
            };
          }
          const maxChars = args.max_chars ?? 4000;
          const sliced = doc.content.slice(0, maxChars);
          return {
            content: [{ type: "text", text: `# ${doc.filename}\n\n${sliced}` }],
          };
        },
      }),
    ],
  });

  const host = defineExtension({
    name: "host",
    sections: [
      section("controlled_hosts", async (input, context) => {
        const scope = await input.read.snapshot(MemoriaScopeDoc, input.conversationId, context);
        const hostIds = scope?.hostIds ?? [];
        if (hostIds.length === 0) return undefined;
        const hosts = hostManager.listPublicHosts().filter((h) => hostIds.includes(h.id));
        if (hosts.length === 0) return undefined;
        const lines = hosts.map((h) => {
          const mode = scope?.hostSecurityModes?.[h.id] ?? h.security_mode;
          return `- [${h.id}] ${h.name} (${h.username}@${h.host}:${h.port}, mode=${mode}${h.default_cwd ? `, cwd=${h.default_cwd}` : ""}${h.os_info ? `, os=${h.os_info}` : ""})`;
        });
        return `当前会话已挂载以下受控主机，可使用 host_exec 与 host_read_log 执行诊断：\n${lines.join("\n")}`;
      }),
    ],
    tools: [
      defineTool({
        name: "host_exec",
        description: "在已授权的受控主机上执行 Shell 命令（受 CommandGuard 三级安全模式与高危命令拦截保护）",
        parameters: Type.Object({
          host_id: Type.String({ description: "目标受控主机 ID" }),
          command: Type.String({ description: "要执行的命令" }),
        }),
        execute: async (args, api, context) => {
          const scope = await api.snapshot(MemoriaScopeDoc, api.conversationId, context);
          if (!scope?.hostIds.includes(args.host_id)) {
            return {
              content: [{ type: "text", text: `主机 ${args.host_id} 未在当前会话启用。` }],
              isError: true,
            };
          }
          const targetHost = hostManager.getDecryptedHost(args.host_id);
          if (!targetHost) {
            return {
              content: [{ type: "text", text: `主机 ${args.host_id} 不存在。` }],
              isError: true,
            };
          }

          const guard = hostManager.createGuardForHost(args.host_id, scope.hostSecurityModes);
          try {
            guard.validateCommand(args.command, false);
          } catch (err) {
            if (err instanceof CommandSafetyViolation) {
              return {
                content: [{ type: "text", text: err.message }],
                isError: true,
              };
            }
            if (err instanceof CommandApprovalRequired) {
              const approval = hostManager.approvalManager.createApproval({
                hostId: args.host_id,
                hostName: targetHost.name,
                command: args.command,
                sessionId: String(api.conversationId),
              });
              await api.details(
                {
                  approval_id: approval.id,
                  host_id: args.host_id,
                  host_name: targetHost.name,
                  command: args.command,
                  status: "pending_approval",
                },
                context,
              );
              const decision = await hostManager.approvalManager.waitForDecision(approval.id, context.abortSignal);
              if (decision !== "approved") {
                await api.details(
                  {
                    host_id: args.host_id,
                    host_name: targetHost.name,
                    command: args.command,
                    status: decision,
                  },
                  context,
                );
                return {
                  content: [
                    {
                      type: "text",
                      text: `命令 '${args.command}' 未获批准 (${decision === "timeout" ? "审批超时" : "用户拒绝执行"})。`,
                    },
                  ],
                  isError: true,
                };
              }
              // 审批通过后立即把 details 切到 running（清掉 approval_id），避免 SSH 执行期间
              // 轮询 /messages 仍看到 pending_approval 导致已同意的审批卡片反复弹出。
              await api.details(
                {
                  host_id: args.host_id,
                  host_name: targetHost.name,
                  command: args.command,
                  status: "running",
                },
                context,
              );
            } else {
              throw err;
            }
          }

          try {
            const res = await hostManager.runOnHost(args.host_id, args.command);
            const truncated = guard.truncateOutput(res.output);
            await api.details(
              {
                host_id: args.host_id,
                host_name: targetHost.name,
                command: args.command,
                exit_code: res.exitCode,
                status: "completed",
              },
              context,
            );
            return {
              content: [{ type: "text", text: truncated || "(命令执行成功，无标准输出)" }],
              isError: res.exitCode !== 0,
            };
          } catch (err: any) {
            return {
              content: [{ type: "text", text: `主机命令执行异常: ${err?.message || err}` }],
              isError: true,
            };
          }
        },
      }),
      defineTool({
        name: "host_read_log",
        description: "安全读取受控主机上指定日志文件末尾若干行（强制截断保护）",
        parameters: Type.Object({
          host_id: Type.String({ description: "目标受控主机 ID" }),
          path: Type.String({ description: "日志文件路径" }),
          lines: Type.Optional(Type.Number({ description: "读取末尾行数，默认 100" })),
        }),
        replay: "safe",
        execute: async (args, api, context) => {
          const scope = await api.snapshot(MemoriaScopeDoc, api.conversationId, context);
          if (!scope?.hostIds.includes(args.host_id)) {
            return {
              content: [{ type: "text", text: `主机 ${args.host_id} 未在当前会话启用。` }],
              isError: true,
            };
          }
          const lines = Math.min(500, Math.max(1, args.lines ?? 100));
          const safePath = args.path.replace(/(["\\$`])/g, "\\$1");
          const guard = hostManager.createGuardForHost(args.host_id, scope.hostSecurityModes);
          try {
            const res = await hostManager.runOnHost(args.host_id, `tail -n ${lines} "${safePath}"`);
            return {
              content: [{ type: "text", text: guard.truncateOutput(res.output) }],
              isError: res.exitCode !== 0,
            };
          } catch (err: any) {
            return {
              content: [{ type: "text", text: `读取日志失败: ${err?.message || err}` }],
              isError: true,
            };
          }
        },
      }),
    ],
  });

  const web = defineExtension({
    name: "web",
    tools: [
      defineTool({
        name: "web_search",
        description: "搜索互联网公开网页与技术文档（支持 DuckDuckGo / Tavily / SearXNG）",
        parameters: Type.Object({
          query: Type.String({ description: "搜索关键词" }),
          max_results: Type.Optional(Type.Number({ description: "最大结果数，默认 5" })),
        }),
        replay: "safe",
        execute: async (args, api, context) => {
          const eff = db.getEffectiveSettings();
          const res = await executeWebSearch({
            query: args.query,
            provider: eff.web_search_provider,
            apiKey: eff.web_search_api_key,
            endpoint: eff.web_search_endpoint,
            maxResults: args.max_results ?? 5,
          });
          if (!res.success) {
            return {
              content: [{ type: "text", text: `联网搜索失败 (${res.provider}): ${res.error}` }],
              isError: true,
            };
          }
          const sources = res.results.map((item, idx) => ({
            type: "web",
            title: item.title,
            url: item.url,
            text: item.snippet,
            score: Number((1 - idx * 0.05).toFixed(2)),
            doc_id: item.url,
            filename: item.title,
          }));
          await api.details({ sources }, context);

          if (res.results.length === 0) {
            return {
              content: [{ type: "text", text: `未找到与 "${args.query}" 相关的网页结果。` }],
            };
          }
          const formatted = res.results
            .map((item, i) => `[#${i + 1}] ${item.title}\nURL: ${item.url}\n摘要: ${item.snippet}`)
            .join("\n\n");
          return {
            content: [{ type: "text", text: formatted }],
          };
        },
      }),
      defineTool({
        name: "web_fetch",
        description: "抓取指定公开网页 URL 的正文文本内容",
        parameters: Type.Object({
          url: Type.String({ description: "要抓取的网页 URL" }),
          max_chars: Type.Optional(Type.Number({ description: "最大字符数，默认 6000" })),
        }),
        replay: "safe",
        execute: async (args) => {
          try {
            const content = await fetchWebPage(args.url, args.max_chars ?? 6000);
            return {
              content: [{ type: "text", text: content || "(网页正文为空)" }],
            };
          } catch (err: any) {
            return {
              content: [{ type: "text", text: `抓取网页失败: ${err?.message || err}` }],
              isError: true,
            };
          }
        },
      }),
    ],
  });

  const subagent: Extension = defineExtension({
    name: "subagent",
    tools: [
      defineTool({
        name: "delegate_subagent",
        description:
          "将需要多步排障、大量日志分析或独立深度检索的子任务委派给隔离的 Subagent 子会话执行，仅返回最终结论以保持当前上下文干净。",
        parameters: Type.Object({
          task: Type.String({ description: "完整、自包含的子任务说明与目标" }),
        }),
        replay: "safe",
        execute: async (args, api, context) => {
          const parentScope = await api.snapshot(MemoriaScopeDoc, api.conversationId, context);
          const parentAgent = await api.agent(context);
          const childScopeConfig: ConversationScope = {
            kbIds: [...(parentScope?.kbIds ?? [])],
            hostIds: [...(parentScope?.hostIds ?? [])],
            hostSecurityModes: { ...(parentScope?.hostSecurityModes ?? {}) },
            webSearch: Boolean(parentScope?.webSearch),
            subagentEnabled: false,
          };
          const childExtensions = resolveExtensionsForScope(childScopeConfig, {
            base,
            knowledge,
            host,
            web,
            subagent,
            all: [base, knowledge, host, web, subagent],
          });

          const childId = await api.commit(async (tx) => {
            const existing = (await tx.scanConversations({ ownerTaskId: api.taskId }, 1)).items[0];
            if (existing !== undefined) return existing.id;

            const created = await tx.createConversation({
              ownership: { kind: "task", taskId: api.taskId },
            });
            const childScope = await tx.doc(MemoriaScopeDoc, created.id);
            childScope.kbIds = childScopeConfig.kbIds;
            childScope.hostIds = childScopeConfig.hostIds;
            childScope.hostSecurityModes = childScopeConfig.hostSecurityModes;
            childScope.webSearch = childScopeConfig.webSearch;
            childScope.subagentEnabled = false;
            await configure(tx, created.id, {
              ...(parentAgent.model ? { model: parentAgent.model } : {}),
              thinkingLevel: parentAgent.thinkingLevel === "off" ? null : parentAgent.thinkingLevel,
              extensions: childExtensions,
            });
            return created.id;
          }, context);

          await api.details({ conversationId: Number(childId), task: args.task }, context);

          const childHandle = await api.conversation(childId, context);
          if (!childHandle) {
            return {
              content: [{ type: "text", text: "无法获取子会话句柄" }],
              isError: true,
            };
          }

          const submission = await childHandle.submit(
            {
              type: "input",
              content: args.task,
              requestId: `subagent:${api.taskId}`,
            },
            context,
          );
          const settled = await submission.wait(context);
          const childEntries = await api.commit(
            async (tx) => (await tx.scanEntries({ conversationId: childId, order: "ascending" }, 200)).items,
            context,
          );
          const childTrace = collectSubagentTrace(childEntries, api.callId);
          const detailsPayload = {
            conversationId: Number(childId),
            task: args.task,
            sources: childTrace.sources,
            usage: childTrace.usage,
            spans: childTrace.spans,
          };
          await api.details(detailsPayload, context);

          if (settled.status === "done" && settled.type === "input") {
            const answerEntry = await api.commit((tx) => tx.entry(AssistantEntry, settled.answer), context);
            const text = extractAssistantText(answerEntry);
            return {
              content: [{ type: "text", text: text || "(子智能体已完成任务，无文本输出)" }],
              details: detailsPayload,
            };
          }
          return {
            content: [{ type: "text", text: `子智能体未完成: ${settled.status}` }],
            isError: true,
            details: detailsPayload,
          };
        },
      }),
    ],
  });

  return {
    base,
    knowledge,
    host,
    web,
    subagent,
    all: [base, knowledge, host, web, subagent],
  };
}

export function resolveExtensionsForScope(
  scope: ConversationScope,
  bundle: MemoriaExtensionsBundle,
): Extension[] {
  const selected: Extension[] = [bundle.base];
  if (scope.kbIds && scope.kbIds.length > 0) {
    selected.push(bundle.knowledge);
  }
  if (scope.hostIds && scope.hostIds.length > 0) {
    selected.push(bundle.host);
  }
  if (scope.webSearch) {
    selected.push(bundle.web);
  }
  if (scope.subagentEnabled !== false) {
    selected.push(bundle.subagent);
  }
  return selected;
}
