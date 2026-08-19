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
}
export interface BotCreate { name: string; system_prompt?: string; kb_ids?: string[]; model_override?: string }
export interface BotUpdate { name?: string; system_prompt?: string; kb_ids?: string[]; model_override?: string }
export interface Session { id: string; bot_id: string | null; session_type?: 'bot' | 'agentic'; title: string; created_at: string }
export interface Message {
  id: string; session_id: string; role: 'user' | 'assistant'; content: string; created_at: string; sources: Source[]; trace?: AgentTrace | null
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
  span_count: number
  tool_count: number
  model_count: number
  error_count: number
}
export interface AgentTraceSpan {
  id?: string | null
  trace_id?: string | null
  parent_id?: string | null
  type: string
  name: string
  started_at?: string | null
  ended_at?: string | null
  duration_ms?: number | null
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
export const listAgentSessions = () => req<Session[]>('/agent-sessions')
export const getAgentMessages = (sessionId: string) => req<Message[]>(`/agent-sessions/${sessionId}/messages`)
export const updateAgentSession = (id: string, data: { title: string }) =>
  req<Session>(`/agent-sessions/${id}`, { method: 'PATCH', ...json(data) })
export const deleteAgentSession = (id: string) => req<void>(`/agent-sessions/${id}`, { method: 'DELETE' })

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
export const updateSession = (id: string, data: { title: string }) =>
  req<Session>(`/sessions/${id}`, { method: 'PATCH', ...json(data) })
export const deleteSession = (id: string) => req<void>(`/sessions/${id}`, { method: 'DELETE' })

export const getSettings = () => req<Settings>('/settings')
export const updateSettings = (data: SettingsUpdate) =>
  req<Settings>('/settings', { method: 'PUT', ...json(data) })
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
