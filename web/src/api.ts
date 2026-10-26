const BASE = '/api'

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${path}`, init)
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  if (r.status === 204) return undefined as T
  return (await r.json()) as T
}

const json = (body: unknown) => ({
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

export type ProviderProtocol =
  | 'openai-completions'
  | 'openai-responses'
  | 'anthropic-messages'
  | 'google-generative-ai'

export interface ModelConfigItem {
  id: string
  name?: string
  reasoning?: boolean
  contextWindow?: number
  maxTokens?: number
}

export interface ModelProviderConfig {
  id: string
  name: string
  protocol: ProviderProtocol
  baseUrl: string
  apiKey: string
  apiKeyMasked?: string
  hasApiKey?: boolean
  enabled: boolean
  models: ModelConfigItem[]
}

export interface AvailableModelOption {
  provider: string
  providerName: string
  modelId: string
  name: string
  reasoning: boolean
  supportedThinkingLevels: ThinkingLevel[]
}

export type HostSecurityMode = 'read_only' | 'ask_confirmation' | 'unrestricted'

export interface ConversationScope {
  kbIds: string[]
  hostIds: string[]
  hostSecurityModes: Record<string, HostSecurityMode>
  webSearch: boolean
  subagentEnabled: boolean
}

export interface Session {
  id: string
  durableId?: number
  title: string
  channel?: 'web' | 'openai' | 'qq'
  modelProvider?: string
  modelId?: string
  thinkingLevel?: ThinkingLevel
  scope?: ConversationScope
  created_at: string
  updated_at?: string
}

export interface KB {
  id: string
  name: string
  description: string
  type: 'upload' | 'vault'
  created_at: string
}

export interface Doc {
  id: string
  kb_id: string
  filename: string
  chunk_count: number
  source: 'upload' | 'vault'
  path?: string
  created_at: string
}

export interface UploadResult {
  doc_id: string
  chunk_count: number
  doc: Doc
}

export interface Message {
  id: string
  entry_id?: number
  session_id: string
  role: 'user' | 'assistant'
  content: string
  status?: string
  metadata?: Record<string, any>
  created_at: string
  sources: Source[]
  trace?: AgentTrace | null
}

export interface Source {
  text: string
  score: number
  doc_id: string
  filename?: string
  path?: string
  source?: string
  kb_id?: string
  db_doc_id?: string
  type?: string
  url?: string
  title?: string
}

export interface AgentSource extends Source {
  kb_id: string
  db_doc_id?: string
}

export interface AgentTraceSummary {
  duration_ms?: number | null
  reasoning?: string | null
  span_count: number
  tool_count: number
  model_count: number
  error_count: number
  total_tokens?: number | null
  prompt_tokens?: number | null
  completion_tokens?: number | null
}

export interface AgentTraceSpan {
  id?: string | null
  trace_id?: string | null
  parent_id?: string | null
  agent_id?: string | null
  agent_name?: string | null
  agent_role?: 'orchestrator' | 'specialist' | string | null
  parent_agent_id?: string | null
  type: string
  name: string
  started_at?: string | null
  ended_at?: string | null
  duration_ms?: number | null
  reasoning?: string | null
  usage?: {
    prompt_tokens?: number | null
    completion_tokens?: number | null
    total_tokens?: number | null
  } | null
  data?: Record<string, unknown>
  error?: unknown
}

export interface AgentTrace {
  id?: string
  session_id?: string
  message_id?: string
  trace_id: string
  workflow_name?: string | null
  group_id?: string | null
  metadata: Record<string, unknown>
  spans: AgentTraceSpan[]
  summary: AgentTraceSummary
  created_at?: string
}

export interface InvocationLog {
  id: string
  timestamp: string
  endpoint: string
  method: string
  model: string
  status_code: number
  duration_ms: number
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  session_id?: string | null
  error_msg?: string | null
}

export interface InvocationLogsResponse {
  items: InvocationLog[]
  limit: number
  offset: number
}

export interface SystemLogsResponse {
  status: string
  file_exists: boolean
  file_size?: number
  total: number
  items: SystemLogItem[]
  message?: string
}

export interface SystemLogItem {
  timestamp: string
  level: string
  component: string
  message: string
  raw: string
}

export interface QQBotLog {
  id: string
  timestamp: string
  category: 'connection' | 'message' | string
  level: 'INFO' | 'WARN' | 'ERROR' | string
  event_type: string
  source_type?: string | null
  source_id?: string | null
  user_name?: string | null
  summary: string
  duration_ms: number
  details?: string | null
}

export interface QQBotStats {
  total_events: number
  message_count: number
  connection_count: number
  error_count: number
  last_event_time?: string | null
}

export interface QQBotStatusResponse {
  status: string
  last_error?: string | null
  stats: QQBotStats
}

export interface QQBotEventsResponse {
  items: QQBotLog[]
  limit: number
  offset: number
  stats: QQBotStats
}

export interface Settings {
  embedding_base_url?: string
  embedding_api_key?: string
  openai_base_url: string
  openai_api_key: string
  external_api_token: string
  embedding_provider?: string
  embedding_model: string
  llm_model: string
  default_provider?: string
  default_thinking_level?: ThinkingLevel
  system_prompt: string
  top_k: string
  min_score?: string
  chunk_size: string
  chunk_overlap: string
  vault_sync_interval_minutes: string
  host_dangerous_patterns?: string
  enable_web_search?: string | boolean
  web_search_provider?: string
  web_search_api_key?: string
  web_search_endpoint?: string
}

export interface SettingsUpdate {
  embedding_base_url?: string
  embedding_api_key?: string
  openai_base_url?: string
  api_key?: string
  external_api_token?: string
  embedding_provider?: string
  embedding_model?: string
  llm_model?: string
  default_provider?: string
  default_thinking_level?: ThinkingLevel
  system_prompt?: string
  top_k?: number
  min_score?: number
  chunk_size?: number
  chunk_overlap?: number
  vault_sync_interval_minutes?: number
  host_dangerous_patterns?: string[]
  enable_web_search?: boolean
  web_search_provider?: string
  web_search_api_key?: string
  web_search_endpoint?: string
}

export interface VaultSchedulerStatus {
  running: boolean
  intervalMinutes: number
  isPollingActive: boolean
  lastPollAt?: string
  autoSyncVaultCount: number
}

// ------------------------------------------------------------------
// Knowledge Bases & Documents
// ------------------------------------------------------------------
export const listKBs = () => req<KB[]>('/knowledge-bases')
export const createKB = (data: {
  name: string
  description?: string
  type: 'upload' | 'vault'
  vault_type?: 'local' | 'webdav'
  local_path?: string
  webdav_url?: string
  webdav_path?: string
  webdav_username?: string
  webdav_password?: string
}) => req<KB>('/knowledge-bases', { method: 'POST', ...json(data) })
export const updateKB = (id: string, data: { name?: string; description?: string }) =>
  req<KB>(`/knowledge-bases/${id}`, { method: 'PATCH', ...json(data) })
export const deleteKB = (id: string) => req<void>(`/knowledge-bases/${id}`, { method: 'DELETE' })
export const listDocs = (kbId: string) => req<Doc[]>(`/knowledge-bases/${kbId}/documents`)
export const uploadDocument = (kbId: string, file: File) => {
  const fd = new FormData()
  fd.append('file', file)
  return req<UploadResult>(`/knowledge-bases/${kbId}/documents`, { method: 'POST', body: fd })
}
export const deleteDocument = (docId: string) => req<void>(`/documents/${docId}`, { method: 'DELETE' })

// ------------------------------------------------------------------
// Multi-Model Providers
// ------------------------------------------------------------------
export const listProviders = () => req<ModelProviderConfig[]>('/providers')
export const createProvider = (data: Partial<ModelProviderConfig>) =>
  req<ModelProviderConfig>('/providers', { method: 'POST', ...json(data) })
export const updateProvider = (id: string, data: Partial<ModelProviderConfig>) =>
  req<ModelProviderConfig>(`/providers/${id}`, { method: 'PUT', ...json(data) })
export const deleteProvider = (id: string) =>
  req<void>(`/providers/${id}`, { method: 'DELETE' })
export const listAvailableModels = () => req<AvailableModelOption[]>('/models/available')

// ------------------------------------------------------------------
// Unified Conversations & Native pi-durable Event Stream
// ------------------------------------------------------------------
export interface AgentStreamEvent {
  type:
    | 'init'
    | 'trace_span'
    | 'thought_delta'
    | 'answer_delta'
    | 'approval_required'
    | 'sources'
    | 'tool_start'
    | 'tool_end'
    | 'inbox_update'
    | 'done'
    | 'error'
  phase?: 'start' | 'end'
  session_id?: string
  message_id?: string
  user_message_id?: string
  span?: AgentTraceSpan
  delta?: string
  // `thought_delta` / `answer_delta` 默认由消费端追加；置 true 表示用本事件的文本整体替换已显示内容，
  // 用于权威全文与已发送文本不一致时（例如模型重试或上游改写已生成内容）。
  replace?: boolean
  detail?: string
  answer?: string
  sources?: AgentSource[]
  used_kbs?: string[]
  trace?: AgentTrace | null
  approval_id?: string
  host_id?: string
  host_name?: string
  command?: string
  tool_name?: string
  tool_agent?: string
  duration_ms?: number
  error?: string
  args?: Record<string, any>
  inbox?: Array<{ id: number; mode: string }>
}

export const listAgentSessions = () => req<Session[]>('/conversations')
export const getAgentSession = (id: string) => req<Session>(`/conversations/${id}`)
export const createAgentSession = (data?: {
  title?: string
  modelProvider?: string
  modelId?: string
  thinkingLevel?: ThinkingLevel
  scope?: Partial<ConversationScope>
}) => req<Session>('/conversations', { method: 'POST', ...json(data ?? {}) })
export const getAgentMessages = (sessionId: string) =>
  req<Message[]>(`/conversations/${sessionId}/messages`)
export const updateAgentSession = (
  id: string,
  data: {
    title?: string
    modelProvider?: string
    modelId?: string
    thinkingLevel?: ThinkingLevel
    scope?: Partial<ConversationScope>
  },
) => req<Session>(`/conversations/${id}`, { method: 'PATCH', ...json(data) })
export const deleteAgentSession = (id: string) =>
  req<void>(`/conversations/${id}`, { method: 'DELETE' })
export const truncateAgentSession = (id: string, data: { message_id: string; inclusive?: boolean }) =>
  req<{ session_id: string; deleted_count: number }>(`/conversations/${id}/truncate`, {
    method: 'POST',
    ...json(data),
  })
export const abortAgentSession = (id: string, data?: { rollback?: boolean; message_id?: string }) =>
  req<{ session_id: string; aborted: boolean }>(`/conversations/${id}/abort`, {
    method: 'POST',
    ...(data ? json(data) : {}),
  })
export const submitToConversation = (
  id: string,
  data: {
    content: string
    whenBusy?: 'steer' | 'followUp'
    modelProvider?: string
    modelId?: string
    thinkingLevel?: ThinkingLevel
    scope?: Partial<ConversationScope>
    wait?: boolean
  },
) =>
  req<{ conversation: Session; submissionId: number; status: string }>(`/conversations/${id}/submit`, {
    method: 'POST',
    ...json(data),
  })

/**
 * 将 pi-durable 的 partial 事件归约为增量文本。
 *
 * pi-durable 的 partial 是「整条消息的最新快照」而非纯增量：`message_start` / `block` / `message` /
 * `message_end` 携带权威全文，而节流的 partial 提交（`partialIntervalMs`）会吞掉最后一段 delta。
 * 所以这里按 `contentIndex` 维护在飞消息的块，增量只追加、快照只对账，再叠加已完成的轮次。
 */
export function createStreamTextReconciler() {
  let committedThought = ''
  let committedAnswer = ''
  const live = new Map<number, { kind: 'thought' | 'answer'; text: string }>()
  let renderedThought = ''
  let renderedAnswer = ''

  const liveText = (kind: 'thought' | 'answer') => {
    // 与 runtime.formatTranscriptToMessages 的拼接一致：思维链块之间用空行，文本块之间用换行。
    const sep = kind === 'thought' ? '\n\n' : '\n'
    const parts: string[] = []
    for (const [, block] of [...live].sort((a, b) => a[0] - b[0])) {
      if (block.kind === kind && block.text) parts.push(block.text)
    }
    return parts.join(sep)
  }
  /** 用一条权威消息重置在飞块（`snapshot` / `message_start` / `block` / `message` / `message_end`）。 */
  const loadBlocks = (message: any) => {
    live.clear()
    // 只有助手消息携带思维链与回答；工具结果/用户消息也会走 `message_start`。
    if (message?.role !== undefined && message.role !== 'assistant') return
    const blocks = Array.isArray(message?.content) ? message.content : []
    blocks.forEach((block: any, index: number) => {
      if (block.type === 'thinking' && typeof block.thinking === 'string') {
        live.set(index, { kind: 'thought', text: block.thinking })
      } else if (block.type === 'text' && typeof block.text === 'string') {
        live.set(index, { kind: 'answer', text: block.text })
      }
    })
  }

  return {
    loadBlocks,
    /** 把增量变更应用到在飞块（`message_update.changes`）。 */
    applyChanges(changes: readonly any[]) {
      for (const ch of changes) {
        if (ch.type === 'thinking_delta' || ch.type === 'text_delta') {
          const kind = ch.type === 'thinking_delta' ? 'thought' : 'answer'
          const block = live.get(ch.contentIndex)
          if (block && block.kind === kind) block.text += ch.delta
          else live.set(ch.contentIndex, { kind, text: ch.delta })
        } else if (ch.type === 'thinking_start' || ch.type === 'text_start') {
          const kind = ch.type === 'thinking_start' ? 'thought' : 'answer'
          const text = (kind === 'thought' ? ch.block?.thinking : ch.block?.text) ?? ''
          live.set(ch.contentIndex, { kind, text })
        } else if (ch.type === 'block') {
          if (ch.block?.type === 'thinking') live.set(ch.contentIndex, { kind: 'thought', text: ch.block.thinking ?? '' })
          else if (ch.block?.type === 'text') live.set(ch.contentIndex, { kind: 'answer', text: ch.block.text ?? '' })
          else live.delete(ch.contentIndex)
        } else if (ch.type === 'message') {
          loadBlocks(ch.message)
        }
      }
    },
    /** 已渲染文本是权威来源：增量只能追加，快照与已渲染不一致时整体替换。 */
    *reconcile(): Generator<AgentStreamEvent> {
      const turn = (committed: string, current: string, sep: string) =>
        committed && current ? `${committed}${sep}${current}` : committed + current
      const wantThought = turn(committedThought, liveText('thought'), '\n\n')
      const wantAnswer = turn(committedAnswer, liveText('answer'), '\n')
      for (const [kind, want, rendered] of [
        ['thought', wantThought, renderedThought],
        ['answer', wantAnswer, renderedAnswer],
      ] as const) {
        if (want === rendered) continue
        if (kind === 'thought') renderedThought = want
        else renderedAnswer = want
        const type = kind === 'thought' ? 'thought_delta' : 'answer_delta'
        yield want.startsWith(rendered)
          ? { type, delta: want.slice(rendered.length) }
          : { type, delta: want, replace: true }
      }
    },
    /** 一轮结束：把已渲染文本固化为后续轮次的前缀。 */
    commit() {
      committedThought = renderedThought
      committedAnswer = renderedAnswer
      live.clear()
    },
  }
}

export async function* streamAgentChat(
  message: string,
  sessionId?: string,
  signal?: AbortSignal,
  options?: {
    modelProvider?: string
    modelId?: string
    thinkingLevel?: ThinkingLevel
    scope?: Partial<ConversationScope>
    whenBusy?: 'steer' | 'followUp'
  },
): AsyncGenerator<AgentStreamEvent> {
  // 1. Admit submission on pi-durable conversation
  const targetId = sessionId || 'new'
  const submitRes = await submitToConversation(targetId, {
    content: message,
    whenBusy: options?.whenBusy ?? 'followUp',
    modelProvider: options?.modelProvider,
    modelId: options?.modelId,
    thinkingLevel: options?.thinkingLevel,
    scope: options?.scope,
  })

  const activeSessionId = submitRes.conversation.id
  yield {
    type: 'init',
    session_id: activeSessionId,
    message_id: `msg_${submitRes.submissionId}`,
    user_message_id: `user_${submitRes.submissionId}`,
  }

  // 2. Attach to native pi-durable watchEvents SSE stream
  const res = await fetch(`${BASE}/conversations/${activeSessionId}/events`, {
    headers: { Accept: 'text/event-stream' },
    signal,
  })
  if (!res.ok || !res.body) {
    throw new Error(`Failed to attach event stream: ${res.status}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const toolStartTimes = new Map<string, number>()
  const text = createStreamTextReconciler()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line.startsWith('data:')) continue
      const dataStr = line.slice(5).trim()
      if (!dataStr) continue
      try {
        const ev = JSON.parse(dataStr)
        if (ev.type === 'snapshot') {
          const snap = ev.snapshot
          text.loadBlocks(snap?.generation?.message)
          yield* text.reconcile()
          // If the run already finished before we attached (fast response!), finish immediately
          if (!snap?.run && !snap?.generation && (!snap?.tools || snap.tools.length === 0)) {
            yield { type: 'done', session_id: activeSessionId }
            return
          }
        } else if (ev.type === 'message_start') {
          text.loadBlocks(ev.message)
          yield* text.reconcile()
        } else if (ev.type === 'message_update' && Array.isArray(ev.changes)) {
          text.applyChanges(ev.changes)
          yield* text.reconcile()
        } else if (ev.type === 'message_end') {
          text.loadBlocks(ev.entry?.model?.[0])
          yield* text.reconcile()
          text.commit()
        } else if (ev.type === 'tool_execution_start') {
          toolStartTimes.set(ev.toolCallId, Date.now())
          const isSubagent = ev.toolName === 'delegate_subagent'
          yield {
            type: 'tool_start',
            tool_name: ev.toolName,
            tool_agent: isSubagent ? 'Subagent' : 'Agent',
            args: ev.args,
          }
          yield {
            type: 'trace_span',
            phase: 'start',
            span: {
              id: ev.toolCallId,
              type: 'tool',
              name: ev.toolName,
              agent_id: isSubagent ? 'subagent' : 'main',
              agent_name: isSubagent ? 'Subagent' : 'Agent',
              agent_role: isSubagent ? 'specialist' : 'orchestrator',
              started_at: new Date().toISOString(),
              data: { input: ev.args },
            },
          }
        } else if (ev.type === 'tool_execution_update') {
          if (ev.details?.sources && Array.isArray(ev.details.sources)) {
            yield {
              type: 'sources',
              sources: ev.details.sources,
            }
          }
          if (ev.details?.approval_id) {
            yield {
              type: 'approval_required',
              approval_id: ev.details.approval_id,
              host_id: ev.details.host_id,
              host_name: ev.details.host_name,
              command: ev.details.command,
            }
          }
        } else if (ev.type === 'tool_execution_end') {
          const started = toolStartTimes.get(ev.toolCallId) ?? Date.now()
          const durationMs = Math.max(1, Date.now() - started)
          const isSubagent = ev.toolName === 'delegate_subagent'
          const toolMsg = ev.entry?.model?.[0]
          const outText = Array.isArray(toolMsg?.content)
            ? toolMsg.content
                .filter((b: any) => b.type === 'text')
                .map((b: any) => b.text)
                .join('\n')
            : ''
          const errText = toolMsg?.isError ? outText || 'Tool execution failed' : undefined

          yield {
            type: 'tool_end',
            tool_name: ev.toolName,
            tool_agent: isSubagent ? 'Subagent' : 'Agent',
            duration_ms: durationMs,
            error: errText,
          }
          yield {
            type: 'trace_span',
            phase: 'end',
            span: {
              id: ev.toolCallId,
              type: 'tool',
              name: ev.toolName,
              agent_id: isSubagent ? 'subagent' : 'main',
              agent_name: isSubagent ? 'Subagent' : 'Agent',
              agent_role: isSubagent ? 'specialist' : 'orchestrator',
              duration_ms: durationMs,
              ended_at: new Date().toISOString(),
              data: {
                output: outText,
                details: toolMsg?.details,
              },
              error: errText,
            },
          }
        } else if (ev.type === 'inbox_update') {
          yield {
            type: 'inbox_update',
            inbox: ev.items,
          }
        } else if (ev.type === 'task_failed') {
          yield {
            type: 'error',
            detail: ev.message || 'Task failed',
          }
          return
        } else if (ev.type === 'run_end') {
          yield {
            type: 'done',
            session_id: activeSessionId,
          }
          return
        }
      } catch (err) {
        console.warn('Failed to parse event:', line, err)
      }
    }
  }
}

// ------------------------------------------------------------------
// Settings & QQ Settings
// ------------------------------------------------------------------
export interface QQSettings {
  enabled: string
  app_id: string
  client_secret: string
  c2c_enabled: string
  group_enabled: string
  group_require_mention: string
  user_allowlist: string
  group_allowlist: string
  allow_unlisted_users: string
  allow_unlisted_groups: string
  group_approval_enabled: string
  max_queue_size: string
  run_timeout_seconds: string
}

export interface QQSettingsUpdate {
  enabled?: boolean
  app_id?: string
  client_secret?: string
  c2c_enabled?: boolean
  group_enabled?: boolean
  group_require_mention?: boolean
  user_allowlist?: string[]
  group_allowlist?: string[]
  allow_unlisted_users?: boolean
  allow_unlisted_groups?: boolean
  group_approval_enabled?: boolean
  max_queue_size?: number
  run_timeout_seconds?: number
}

export const getSettings = () => req<Settings>('/settings')
export const updateSettings = (data: SettingsUpdate) =>
  req<Settings>('/settings', { method: 'PUT', ...json(data) })
export const fetchModels = (data?: {
  providerId?: string
  baseUrl?: string
  api_key?: string
  apiKey?: string
  openai_base_url?: string
  embedding_base_url?: string
  embedding_api_key?: string
}) =>
  req<{ models: string[] }>('/settings/fetch-models', {
    method: 'POST',
    ...json(data || {}),
  })
export const testEmbedding = (data?: {
  openai_base_url?: string
  api_key?: string
  embedding_base_url?: string
  embedding_api_key?: string
  embedding_provider?: string
  embedding_model?: string
}) =>
  req<{ ok: boolean; dimensions: number; elapsed_ms?: number }>('/settings/test-embedding', {
    method: 'POST',
    ...json(data || {}),
  })
export const getVaultSchedulerStatus = () => req<VaultSchedulerStatus>('/vaults/scheduler')
export const triggerVaultScheduler = () =>
  req<{ ok: boolean; message: string }>('/vaults/scheduler/trigger', { method: 'POST' })
export const testChat = (data?: {
  providerId?: string
  modelId?: string
  baseUrl?: string
  apiKey?: string
  openai_base_url?: string
  api_key?: string
  llm_model?: string
}) =>
  req<{ ok: boolean; elapsed_ms: number; detail?: string }>('/settings/test-chat', {
    method: 'POST',
    ...json(data || {}),
  })
export const getQQSettings = () => req<QQSettings>('/settings/qq')
export const updateQQSettings = (data: QQSettingsUpdate) =>
  req<QQSettings>('/settings/qq', { method: 'PUT', ...json(data) })
export const getQQStatus = () =>
  req<{ status: string; last_error: string | null }>('/settings/qq/status')

// ------------------------------------------------------------------
// Vaults
// ------------------------------------------------------------------
export interface Vault {
  id: string
  kb_id: string
  type: 'local' | 'webdav'
  local_path?: string
  webdav_url?: string
  webdav_path?: string
  webdav_username?: string
  last_synced_at: string | null
  syncing: boolean
  auto_sync: boolean
  created_at: string
}

export interface VaultCreate {
  type: 'local' | 'webdav'
  local_path?: string
  webdav_url?: string
  webdav_path?: string
  webdav_username?: string
  webdav_password?: string
}

export interface VaultUpdate {
  auto_sync?: boolean
  type?: 'local' | 'webdav'
  local_path?: string
  webdav_url?: string
  webdav_path?: string
  webdav_username?: string
  webdav_password?: string
}

export const getVault = (kbId: string) => req<Vault>(`/knowledge-bases/${kbId}/vault`)
export const createVault = (kbId: string, data: VaultCreate) =>
  req<Vault>(`/knowledge-bases/${kbId}/vault`, { method: 'POST', ...json(data) })
export const deleteVault = (kbId: string) =>
  req<void>(`/knowledge-bases/${kbId}/vault`, { method: 'DELETE' })
export const syncVault = (kbId: string) =>
  req<{ status: string }>(`/knowledge-bases/${kbId}/vault/sync`, { method: 'POST' })
export const cancelVaultSync = (kbId: string): Promise<void> =>
  req<void>(`/knowledge-bases/${kbId}/vault/sync`, { method: 'DELETE' })
export const updateVault = (kbId: string, body: VaultUpdate): Promise<Vault> =>
  req<Vault>(`/knowledge-bases/${kbId}/vault`, { method: 'PATCH', ...json(body) })

export interface RestoreResult {
  ok: boolean
  message: string
  kbs_count: number
  vaults_count: number
  vaults: Vault[]
}

export const exportBackupUrl = () => `${BASE}/settings/backup/export`

export const importBackup = async (file: File): Promise<RestoreResult> => {
  const fd = new FormData()
  fd.append('file', file)
  const r = await fetch(`${BASE}/settings/backup/import`, {
    method: 'POST',
    body: fd,
  })
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  return (await r.json()) as RestoreResult
}

export interface VaultPathEntry {
  name: string
  path: string
  type: 'directory'
}
export interface VaultPathBrowseResult {
  path: string
  parent: string | null
  entries: VaultPathEntry[]
}
export interface WebDAVTestResult {
  ok: boolean
  file_count: number
  path: string
}

export const browseLocalVaultPath = (path?: string) =>
  req<VaultPathBrowseResult>('/vaults/browse-local', { method: 'POST', ...json({ path }) })
export const browseWebDAVVaultPath = (data: {
  webdav_url: string
  webdav_username?: string
  webdav_password?: string
  path?: string
}) => req<VaultPathBrowseResult>('/vaults/browse-webdav', { method: 'POST', ...json(data) })
export const testWebDAVVault = (data: {
  webdav_url: string
  webdav_path?: string
  webdav_username?: string
  webdav_password?: string
}) => req<WebDAVTestResult>('/vaults/test-webdav', { method: 'POST', ...json(data) })

// ------------------------------------------------------------------
// Controlled Hosts
// ------------------------------------------------------------------
export interface Host {
  id: string
  name: string
  host: string
  port: number
  username: string
  auth_type: 'password' | 'key'
  credential_set: boolean
  proxy_url?: string
  proxy_url_set?: boolean
  default_cwd?: string
  description: string
  tags: string[]
  safe_mode: boolean
  security_mode?: HostSecurityMode
  status: 'active' | 'inactive' | 'error'
  os_info?: string
  created_at: string
  updated_at: string
}

export interface HostCreate {
  name: string
  host: string
  port?: number
  username: string
  auth_type?: 'password' | 'key'
  credential?: string
  proxy_url?: string
  default_cwd?: string
  description?: string
  tags?: string[]
  safe_mode?: boolean
  security_mode?: HostSecurityMode
}

export interface HostUpdate extends Partial<HostCreate> {}
export interface TestHostResult {
  ok: boolean
  message?: string
  os_info?: string
  latency_ms?: number
}

export const listHosts = () => req<Host[]>('/hosts')
export const getHost = (id: string) => req<Host>(`/hosts/${id}`)
export const createHost = (data: HostCreate) => req<Host>('/hosts', { method: 'POST', ...json(data) })
export const updateHost = (id: string, data: HostUpdate) =>
  req<Host>(`/hosts/${id}`, { method: 'PUT', ...json(data) })
export const deleteHost = (id: string) => req<void>(`/hosts/${id}`, { method: 'DELETE' })
export const testHostConnection = (id: string) =>
  req<TestHostResult>(`/hosts/${id}/test`, { method: 'POST' })

export interface ApprovalRespondResult {
  id: string
  status: 'approved' | 'rejected'
  command: string
  host_id: string
}

export const respondHostApproval = (approvalId: string, approved: boolean) =>
  req<ApprovalRespondResult>(`/hosts/approvals/${approvalId}/respond`, {
    method: 'POST',
    ...json({ approved }),
  })

// ------------------------------------------------------------------
// Logs
// ------------------------------------------------------------------
export const logsApi = {
  listInvocations: (params?: { limit?: number; offset?: number }) => {
    const q = new URLSearchParams()
    if (params?.limit) q.set('limit', String(params.limit))
    if (params?.offset) q.set('offset', String(params.offset))
    const queryStr = q.toString() ? `?${q.toString()}` : ''
    return req<InvocationLogsResponse>(`/logs/invocations${queryStr}`)
  },
  clearInvocations: () => req<void>('/logs/invocations', { method: 'DELETE' }),
  getQQBotStatus: () => req<QQBotStatusResponse>('/logs/qqbot/status'),
  listQQBotEvents: (params?: { category?: string; level?: string; limit?: number; offset?: number }) => {
    const q = new URLSearchParams()
    if (params?.category) q.set('category', params.category)
    if (params?.level) q.set('level', params.level)
    if (params?.limit) q.set('limit', String(params.limit))
    if (params?.offset) q.set('offset', String(params.offset))
    const queryStr = q.toString() ? `?${q.toString()}` : ''
    return req<QQBotEventsResponse>(`/logs/qqbot/events${queryStr}`)
  },
  clearQQBotEvents: (category?: string) => {
    const q = new URLSearchParams()
    if (category) q.set('category', category)
    const queryStr = q.toString() ? `?${q.toString()}` : ''
    return req<void>(`/logs/qqbot/events${queryStr}`, { method: 'DELETE' })
  },
  getSystemLogs: (params?: { lines?: number; level?: string; search?: string }) => {
    const q = new URLSearchParams()
    if (params?.lines) q.set('lines', String(params.lines))
    if (params?.level) q.set('level', params.level)
    if (params?.search) q.set('search', params.search)
    const queryStr = q.toString() ? `?${q.toString()}` : ''
    return req<SystemLogsResponse>(`/logs/system${queryStr}`)
  },
  getSystemLogDownloadUrl: () => `${BASE}/logs/system/download`,
}

// ------------------------------------------------------------------
// Health & System Info
// ------------------------------------------------------------------
export interface HealthStatus {
  status: string
  runtime: string
  version: string
}

export const getHealth = () => req<HealthStatus>('/health')

