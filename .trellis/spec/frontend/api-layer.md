# API Layer

> Typed API client conventions for the frontend.

---

## Overview

All backend communication lives in a single file: `web/src/api.ts`. It exports a generic `req<T>()` fetch wrapper plus typed interfaces for every entity and one named function per endpoint. Components never call `fetch` directly; they import `* as api from '@/api'` and pass the named functions to TanStack Query.

---

## The req() Wrapper

```ts
const BASE = '/api'

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}${path}`, init)
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`)
  if (r.status === 204) return undefined as T
  return r.json()
}
```

Conventions:

- **Base path**: always `/api` (relative, same-origin).
- **Error handling**: non-ok responses throw an `Error` with the status code and response body. There is no retry or toast layer here; UI components handle error display via TanStack Query's error state.
- **204 No Content**: returns `undefined` (typed as `T`). Deletion endpoints use this.
- **Management auth boundary**: `req()` does not add authentication headers for same-origin `/api` management calls. OpenAI-compatible browser calls under `/v1` must read the configured inbound token through the settings flow and send it as `Authorization: Bearer <token>` only when configured.

---

## JSON Body Helper

```ts
const json = (body: unknown) => ({
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})
```

Use this for all POST/PUT/PATCH with a JSON body. For file uploads, use `FormData` directly and do not set a content-type header (the browser sets the multipart boundary).

---

## Typed Interfaces

Every entity has an exported interface mirroring the backend dict shape:

- `KB`, `Doc`, `Bot`, `Session`, `Message`, `Source`, `ChatResponse`, `Settings`, `Vault`
- Request types: `BotCreate`, `BotUpdate`, `SettingsUpdate`, `VaultCreate`

Add a new interface whenever a new backend entity is introduced. Keep field names in sync with the backend dict keys (snake_case from the API, e.g. `created_at`).

---

## Endpoint Functions

Each endpoint is a named export. Naming follows REST conventions:

- `list*` for GET collections: `listKBs()`, `listDocs(kbId)`, `listBots()`, `listSessions(botId)`.
- `create*` for POST: `createKB(data)`, `createBot(data)`, `createVault(kbId, data)`.
- `update*` for PUT/PATCH: `updateKB(id, data)`, `updateBot(id, data)`, `updateVault(kbId, body)`.
- `delete*` for DELETE: `deleteKB(id)`, `deleteDocument(docId)`, `deleteSession(id)`.
- Verbs for actions: `chat(botId, message, sessionId?)`, `syncVault(kbId)`, `cancelVaultSync(kbId)`, `testEmbedding()`, `testChat()`.

```ts
export const chat = (botId: string, message: string, sessionId?: string) =>
  req<ChatResponse>(`/chat/${botId}`, { method: 'POST', ...json({ message, session_id: sessionId }) })
```

---

## Common Mistakes

1. **Calling fetch directly from a component.** Always add a named function in api.ts first, then use it via TanStack Query.
2. **Forgetting to type the response.** Every `req<T>()` call must specify the response interface, e.g. `req<Bot[]>('/bots')`.
3. **Mismatching field casing.** Backend uses snake_case (`created_at`, `system_prompt`); interfaces must match, not camelCase.
4. **Setting Content-Type on FormData uploads.** Do not use the `json()` helper for file uploads; pass `body: fd` without headers so the browser sets the multipart boundary.
5. **Not invalidating cache after mutations.** After a successful create/update/delete, call `queryClient.invalidateQueries({ queryKey })` for the affected list so the UI refreshes.
