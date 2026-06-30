const BASE = '/api'

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${path}`, init)
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  if (r.status === 204) return undefined as T
  return r.json()
}

export interface KB { id: string; name: string; description: string; type: 'upload' | 'vault'; created_at: string }
export interface Doc { id: string; kb_id: string; filename: string; chunk_count: number; source: 'upload' | 'vault'; created_at: string }
export interface UploadResult { doc_id: string; chunk_count: number; doc: Doc }
export interface Bot {
  id: string; name: string; system_prompt: string;
  model_override: string | null; kb_ids: string[]; created_at: string
}
export interface BotCreate { name: string; system_prompt?: string; kb_ids?: string[]; model_override?: string }
export interface BotUpdate { name?: string; system_prompt?: string; kb_ids?: string[]; model_override?: string }
export interface Session { id: string; bot_id: string; created_at: string }
export interface Message {
  id: string; session_id: string; role: 'user' | 'assistant'; content: string; created_at: string; sources: Source[]
}
export interface Source { text: string; score: number; doc_id: string }
export interface ChatResponse { answer: string; session_id: string; sources: Source[] }
export interface Settings {
  openai_base_url: string; openai_api_key: string; embedding_model: string;
  llm_model: string; top_k: string; chunk_size: string; chunk_overlap: string
}
export interface SettingsUpdate {
  openai_base_url?: string; api_key?: string; embedding_model?: string;
  llm_model?: string; top_k?: number; min_score?: number; chunk_size?: number; chunk_overlap?: number
}

const json = (body: unknown) => ({
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const listKBs = () => req<KB[]>('/knowledge-bases')
export const createKB = (data: {
  name: string; description?: string; type: 'upload' | 'vault';
  vault_type?: 'local' | 'webdav';
  local_path?: string; webdav_url?: string; webdav_username?: string; webdav_password?: string;
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
export const getMessages = (sessionId: string) => req<Message[]>(`/sessions/${sessionId}/messages`)

export const getSettings = () => req<Settings>('/settings')
export const updateSettings = (data: SettingsUpdate) =>
  req<Settings>('/settings', { method: 'PUT', ...json(data) })
export const testEmbedding = () =>
  req<{ ok: boolean; dimensions: number }>('/settings/test-embedding', { method: 'POST' })
export const testChat = () =>
  req<{ ok: boolean; elapsed_ms: number }>('/settings/test-chat', { method: 'POST' })

export interface Vault {
  id: string; kb_id: string; type: 'local' | 'webdav';
  local_path?: string; webdav_url?: string; webdav_username?: string;
  last_synced_at: string | null; syncing: boolean; created_at: string;
}
export interface VaultCreate {
  type: 'local' | 'webdav';
  local_path?: string;
  webdav_url?: string; webdav_username?: string; webdav_password?: string;
}

export const getVault = (kbId: string) => req<Vault>(`/knowledge-bases/${kbId}/vault`)
export const createVault = (kbId: string, data: VaultCreate) =>
  req<Vault>(`/knowledge-bases/${kbId}/vault`, { method: 'POST', ...json(data) })
export const deleteVault = (kbId: string) =>
  req<void>(`/knowledge-bases/${kbId}/vault`, { method: 'DELETE' })
export const syncVault = (kbId: string) =>
  req<{ status: string }>(`/knowledge-bases/${kbId}/vault/sync`, { method: 'POST' })
