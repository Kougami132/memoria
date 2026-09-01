const BASE = '/api'

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${path}`, init)
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  if (r.status === 204) return undefined as T
  return r.json()
}

export interface KB { id: string; name: string; description: string; type: 'upload' | 'vault'; created_at: string }
export interface Doc { id: string; kb_id: string; filename: string; chunk_count: number; source: 'upload' | 'vault'; path?: string; created_at: string }
export interface UploadResult { doc_id: string; chunk_count: number; doc: Doc }
export interface Bot {
  id: string; name: string; system_prompt: string;
  model_override: string | null; kb_ids: string[]; created_at: string
  host_ids?: string[]
  host_security_modes?: Record<string, HostSecurityMode>
}
export interface BotCreate {
  name: string
  system_prompt?: string
  kb_ids?: string[]
  host_ids?: string[]
  host_security_modes?: Record<string, HostSecurityMode>
  model_override?: string
}
export interface BotUpdate {
  name?: string
  system_prompt?: string
  kb_ids?: string[]
  host_ids?: string[]
  host_security_modes?: Record<string, HostSecurityMode>
  model_override?: string
}
export interface Session { id: string; bot_id: string | null; session_type?: 'bot' | 'agentic'; title: string; created_at: string }
export interface Message {
  id: string; session_id: string; role: 'user' | 'assistant'; content: string; status?: string; metadata?: Record<string, any>; created_at: string; sources: Source[]; trace?: AgentTrace | null
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
}
export interface ChatResponse { answer: string; session_id: string; sources: Source[] }
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
  placeholder: boolean
  message: string
  items: any[]
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
export interface AgentChatResponse {
  answer: string
  session_id: string
  used_kbs: string[]
  sources: AgentSource[]
  trace?: AgentTrace | null
}
export interface ChatStreamMetaEvent { type: 'meta'; session_id: string; sources: Source[] }
export interface ChatStreamDeltaEvent { type: 'delta'; delta: string }
export interface ChatStreamStatusEvent { type: 'status'; message: string }
export interface ChatStreamFinalEvent { type: 'final'; answer: string; session_id: string; sources: Source[] }
export interface ChatStreamErrorEvent { type: 'error'; detail: string }
export type ChatStreamEvent = ChatStreamMetaEvent | ChatStreamDeltaEvent | ChatStreamStatusEvent | ChatStreamFinalEvent | ChatStreamErrorEvent
export interface Settings {
  openai_base_url: string; openai_api_key: string; embedding_model: string;
  llm_model: string; system_prompt: string; top_k: string; chunk_size: string; chunk_overlap: string;
  vault_sync_interval_minutes: string
  host_dangerous_patterns?: string
}
export interface SettingsUpdate {
  openai_base_url?: string; api_key?: string; embedding_model?: string;
  llm_model?: string; system_prompt?: string; top_k?: number; min_score?: number; chunk_size?: number; chunk_overlap?: number;
  vault_sync_interval_minutes?: number
}

const json = (body: unknown) => ({
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const listKBs = () => req<KB[]>('/knowledge-bases')
export const createKB = (data: {
  name: string; description?: string; type: 'upload' | 'vault';
  vault_type?: 'local' | 'webdav';
  local_path?: string; webdav_url?: string; webdav_path?: string; webdav_username?: string; webdav_password?: string;
}) => req<KB>('/knowledge-bases', { method: 'POST', ...json(data) })
export const updateKB = (id: string, data: { name?: string; description?: string }) =>
  req<KB>(`/knowledge-bases/${id}`, { method: 'PATCH', ...json(data) })
export const deleteKB = (id: string) => req<void>(`/knowledge-bases/${id}`, { method: 'DELETE' })
export const listDocs = (kbId: string) => req<Doc[]>(`/knowledge-bases/${kbId}/documents`)
export const uploadDocument = (kbId: string, file: File) => {
  const fd = new FormData(); fd.append('file', file)
  return req<UploadResult>(`/knowledge-bases/${kbId}/documents`, { method: 'POST', body: fd })
}
export const deleteDocument = (docId: string) => req<void>(`/documents/${docId}`, { method: 'DELETE' })

export const listBots = () => req<Bot[]>('/bots')
export const createBot = (data: BotCreate) => req<Bot>('/bots', { method: 'POST', ...json(data) })
export const updateBot = (id: string, data: BotUpdate) =>
  req<Bot>(`/bots/${id}`, { method: 'PUT', ...json(data) })
export const deleteBot = (id: string) => req<void>(`/bots/${id}`, { method: 'DELETE' })
export const listSessions = (botId: string) => req<Session[]>(`/bots/${botId}/sessions`)

export const chat = (botId: string, message: string, sessionId?: string) =>
  req<ChatResponse>(`/chat/${botId}`, { method: 'POST', ...json({ message, session_id: sessionId }) })

export const agentChat = (message: string, sessionId?: string) =>
  req<AgentChatResponse>('/agent-chat', {
    method: 'POST',
    ...json({ message, session_id: sessionId }),
  })

export interface AgentStreamEvent {
  type: 'init' | 'trace_span' | 'thought_delta' | 'answer_delta' | 'approval_required' | 'sources' | 'done' | 'error'
  phase?: 'start' | 'end'
  session_id?: string
  message_id?: string
  user_message_id?: string
  span?: AgentTraceSpan
  delta?: string
  detail?: string
  answer?: string
  sources?: AgentSource[]
  used_kbs?: string[]
  trace?: AgentTrace | null
  approval_id?: string
  host_id?: string
  host_name?: string
  command?: string
}

export async function* streamResponses(
  model: string,
  input: string,
  sessionId?: string,
  signal?: AbortSignal,
): AsyncGenerator<AgentStreamEvent> {
  const res = await fetch('/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Memoria-Client': 'web',
    },
    body: JSON.stringify({
      model,
      input,
      conversation_id: sessionId,
      stream: true,
    }),
    signal,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? 'Responses stream request failed')
  }
  if (!res.body) throw new Error('ReadableStream not supported')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      if (line.startsWith('data:')) {
        const dataStr = line.slice(5).trim()
        if (!dataStr || dataStr === '[DONE]') continue
        try {
          const parsed = JSON.parse(dataStr)
          // Map OpenAI response SSE events to AgentStreamEvent
          if (parsed.type === 'response.session_updated') {
            yield {
              type: 'init',
              session_id: parsed.session_id,
              message_id: parsed.message_id,
              user_message_id: parsed.user_message_id,
            }
          } else if (parsed.type === 'response.thought.delta') {
            yield {
              type: 'thought_delta',
              delta: parsed.delta,
            }
          } else if (parsed.type === 'response.approval_required') {
            yield {
              type: 'approval_required',
              approval_id: parsed.approval_id,
              host_id: parsed.host_id,
              host_name: parsed.host_name,
              command: parsed.command,
            }
          } else if (parsed.type === 'response.text.delta') {
            yield {
              type: 'answer_delta',
              delta: parsed.delta,
            }
          } else if (parsed.type === 'response.output_item.added') {
            const spanObj = parsed.span || parsed.item
            if (spanObj && (spanObj.type === 'tool_call' || spanObj.type === 'agent' || spanObj.type === 'guardrail' || spanObj.type === 'model' || spanObj.type === 'generation' || spanObj.type === 'tool' || spanObj.type === 'function' || spanObj.type === 'span')) {
              yield {
                type: 'trace_span',
                phase: 'start',
                span: spanObj,
              }
            }
          } else if (parsed.type === 'response.output_item.done') {
            const spanObj = parsed.span || parsed.item
            if (spanObj && (spanObj.type === 'tool_call' || spanObj.type === 'agent' || spanObj.type === 'guardrail' || spanObj.type === 'model' || spanObj.type === 'generation' || spanObj.type === 'tool' || spanObj.type === 'function' || spanObj.type === 'span')) {
              yield {
                type: 'trace_span',
                phase: 'end',
                span: spanObj,
              }
            }
          } else if (parsed.type === 'response.sources') {
            yield {
              type: 'sources',
              sources: parsed.sources,
            }
          } else if (parsed.type === 'response.error') {
            yield {
              type: 'error',
              detail: parsed.error?.message || 'Unknown stream error',
            }
          } else if (parsed.type === 'response.completed') {
            yield {
              type: 'done',
              session_id: parsed.response?.conversation_id,
              message_id: '',
              answer: '',
            }
          }
        } catch (e) {
          console.warn('Failed to parse SSE line:', line, e)
        }
      }
    }
  }
}

export async function* streamAgentChat(
  message: string,
  sessionId?: string,
  signal?: AbortSignal,
): AsyncGenerator<AgentStreamEvent> {
  yield* streamResponses('memoria-agent', message, sessionId, signal)
}

export async function* streamBotChat(
  botId: string,
  message: string,
  sessionId?: string,
  signal?: AbortSignal,
): AsyncGenerator<AgentStreamEvent> {
  yield* streamResponses(`bot:${botId}`, message, sessionId, signal)
}
export const listAgentSessions = () => req<Session[]>('/agent-sessions')
export const getAgentMessages = (sessionId: string) => req<Message[]>(`/agent-sessions/${sessionId}/messages`)
export const updateAgentSession = (id: string, data: { title: string }) =>
  req<Session>(`/agent-sessions/${id}`, { method: 'PATCH', ...json(data) })
export const deleteAgentSession = (id: string) => req<void>(`/agent-sessions/${id}`, { method: 'DELETE' })
export const truncateAgentSession = (id: string, data: { message_id: string; inclusive?: boolean }) =>
  req<{ session_id: string; deleted_count: number }>(`/agent-sessions/${id}/truncate`, { method: 'POST', ...json(data) })
export const abortAgentSession = (id: string, data?: { rollback?: boolean; message_id?: string }) =>
  req<{ session_id: string; aborted: boolean }>(`/agent-sessions/${id}/abort`, { method: 'POST', ...(data ? json(data) : {}) })

export async function chatStream(
  botId: string,
  message: string,
  sessionId: string | undefined,
  onEvent?: (event: ChatStreamEvent) => void,
): Promise<ChatStreamFinalEvent> {
  const r = await fetch(`${BASE}/chat/${botId}/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, session_id: sessionId }),
  })
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  if (!r.body) throw new Error('Streaming is not supported by this browser')

  const reader = r.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let final: ChatStreamFinalEvent | null = null

  const handleLine = (line: string) => {
    const trimmed = line.trim()
    if (!trimmed) return
    const event = JSON.parse(trimmed) as ChatStreamEvent
    onEvent?.(event)
    if (event.type === 'error') throw new Error(event.detail || 'Stream failed')
    if (event.type === 'final') final = event
  }

  while (true) {
    const { value, done } = await reader.read()
    if (value) buffer += decoder.decode(value, { stream: !done })
    let newlineIndex = buffer.indexOf('\n')
    while (newlineIndex >= 0) {
      handleLine(buffer.slice(0, newlineIndex))
      buffer = buffer.slice(newlineIndex + 1)
      newlineIndex = buffer.indexOf('\n')
    }
    if (done) break
  }

  if (buffer.trim()) handleLine(buffer)
  if (!final) throw new Error('Stream ended before final response')
  return final
}

export const getMessages = (sessionId: string) => req<Message[]>(`/sessions/${sessionId}/messages`)
export const getSession = (sessionId: string) => req<Session>(`/sessions/${sessionId}`)
export const updateSession = (id: string, data: { title: string }) =>
  req<Session>(`/sessions/${id}`, { method: 'PATCH', ...json(data) })
export const deleteSession = (id: string) => req<void>(`/sessions/${id}`, { method: 'DELETE' })
export const truncateSession = (id: string, data: { message_id: string; inclusive?: boolean }) =>
  req<{ session_id: string; deleted_count: number }>(`/sessions/${id}/truncate`, { method: 'POST', ...json(data) })
export const abortSession = (id: string, data?: { rollback?: boolean; message_id?: string }) =>
  req<{ session_id: string; aborted: boolean }>(`/sessions/${id}/abort`, { method: 'POST', ...(data ? json(data) : {}) })

export const getSettings = () => req<Settings>('/settings')
export const updateSettings = (data: SettingsUpdate) =>
  req<Settings>('/settings', { method: 'PUT', ...json(data) })
export const fetchModels = (data?: { openai_base_url?: string; api_key?: string }) =>
  req<{ models: string[] }>('/settings/fetch-models', {
    method: 'POST',
    ...json(data || {}),
  })
export const testEmbedding = () =>
  req<{ ok: boolean; dimensions: number }>('/settings/test-embedding', { method: 'POST' })
export const testChat = () =>
  req<{ ok: boolean; elapsed_ms: number }>('/settings/test-chat', { method: 'POST' })

export interface Vault {
  id: string; kb_id: string; type: 'local' | 'webdav';
  local_path?: string; webdav_url?: string; webdav_path?: string; webdav_username?: string;
  last_synced_at: string | null; syncing: boolean; auto_sync: boolean; created_at: string;
}
export interface VaultCreate {
  type: 'local' | 'webdav';
  local_path?: string;
  webdav_url?: string; webdav_path?: string; webdav_username?: string; webdav_password?: string;
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
export const updateVault = (kbId: string, body: { auto_sync: boolean }): Promise<Vault> =>
  req<Vault>(`/knowledge-bases/${kbId}/vault`, { method: 'PATCH', ...json(body) })

export interface VaultPathEntry { name: string; path: string; type: 'directory' }
export interface VaultPathBrowseResult { path: string; parent: string | null; entries: VaultPathEntry[] }
export interface WebDAVTestResult { ok: boolean; file_count: number; path: string }

export const browseLocalVaultPath = (path?: string) =>
  req<VaultPathBrowseResult>('/vaults/browse-local', { method: 'POST', ...json({ path }) })
export const browseWebDAVVaultPath = (data: {
  webdav_url: string; webdav_username?: string; webdav_password?: string; path?: string;
}) => req<VaultPathBrowseResult>('/vaults/browse-webdav', { method: 'POST', ...json(data) })
export const testWebDAVVault = (data: {
  webdav_url: string; webdav_path?: string; webdav_username?: string; webdav_password?: string;
}) => req<WebDAVTestResult>('/vaults/test-webdav', { method: 'POST', ...json(data) })
export type HostSecurityMode = 'read_only' | 'ask_confirmation' | 'unrestricted'

export interface Host {
  id: string
  name: string
  host: string
  port: number
  username: string
  auth_type: 'password' | 'key'
  credential_set: boolean
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
  description?: string
  tags?: string[]
  safe_mode?: boolean
  security_mode?: HostSecurityMode
}
export interface HostUpdate extends Partial<HostCreate> {}
export interface TestHostResult { ok: boolean; message?: string; os_info?: string; latency_ms?: number }

export const listHosts = () => req<Host[]>('/hosts')
export const getHost = (id: string) => req<Host>(`/hosts/${id}`)
export const createHost = (data: HostCreate) => req<Host>('/hosts', { method: 'POST', ...json(data) })
export const updateHost = (id: string, data: HostUpdate) => req<Host>(`/hosts/${id}`, { method: 'PUT', ...json(data) })
export const deleteHost = (id: string) => req<void>(`/hosts/${id}`, { method: 'DELETE' })
export const testHostConnection = (id: string) => req<TestHostResult>(`/hosts/${id}/test`, { method: 'POST' })

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

export const logsApi = {
  listInvocations: (params?: { limit?: number; offset?: number }) => {
    const q = new URLSearchParams()
    if (params?.limit) q.set('limit', String(params.limit))
    if (params?.offset) q.set('offset', String(params.offset))
    const queryStr = q.toString() ? `?${q.toString()}` : ''
    return req<InvocationLogsResponse>(`/logs/invocations${queryStr}`)
  },
  clearInvocations: () => req<void>('/logs/invocations', { method: 'DELETE' }),
  getSystemLogs: () => req<SystemLogsResponse>('/logs/system'),
}
