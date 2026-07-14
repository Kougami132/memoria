# Component Patterns

> React component conventions for the frontend.

---

## Overview

Pages are the top-level route components in `web/src/pages/` (KnowledgeBases, Bots, Chat, Settings). Reusable shadcn/ui primitives live in `web/src/components/ui/`. The app shell is `Layout.tsx` with a `NavLink` sidebar and an `Outlet` for page content. All components are function components using hooks; there are no class components.

---

## State Management

- **Server state**: use TanStack Query (`useQuery` for reads, `useMutation` for writes). Never store server data in `useState`. Define query keys as stable arrays (e.g. `['bots']`, `['sessions', botId]`).
- **UI state**: local `useState` for ephemeral view state (selected id, open/closed toggles, form inputs). Keep it close to where it is used.
- **No global state store**: there is no Redux or Zustand. Cross-page state is persisted on the server and re-fetched via TanStack Query.

```tsx
const { data: bots = [] } = useQuery({ queryKey: ['bots'], queryFn: api.listBots })
const mutation = useMutation({ mutationFn: api.createBot, onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bots'] }) })
```

---

## Component Structure

Each page is a single default-export function component. Inline sub-components for page-specific UI (e.g. `SourceList` inside `Chat.tsx`) are defined in the same file above the main component. Only break a sub-component into its own file when it is reused across pages.

- Default export at the bottom of the file.
- Named helper components above the default export.
- Typed props via inline interfaces.

---

## Data Fetching

All backend communication goes through `web/src/api.ts`. Components import the api module (`import * as api from '@/api'`) and pass typed functions to TanStack Query. Never call `fetch` directly from a component.

- **Reads**: `useQuery({ queryKey, queryFn: api.someFn })`.
- **Writes**: `useMutation({ mutationFn, onSuccess })` with cache invalidation.
- **Mutations that create**: invalidate the relevant list query on success.

---

## Path Alias

Use the `@` path alias for all imports (configured in vite.config / tsconfig). Never use relative paths that traverse above the current directory.

```tsx
import { Button } from '@/components/ui/button'
import * as api from '@/api'
```

---

## Markdown Rendering

Assistant messages are rendered with `react-markdown` using a shared `mdComponents` map of custom renderers. The components apply Tailwind classes to constrain typography (margins, list styling, code blocks). Inline code uses `bg-muted rounded px-1`; code blocks use `bg-muted rounded-xl p-3 overflow-x-auto`.

---

## TypeScript

- All components are typed; props use inline `interface` declarations.
- API response types come from `web/src/api.ts` (imported as `type`).
- Prefer `const` arrow sub-components over function declarations for renderers.
- File extensions: `.tsx` for components, `.ts` for logic/api.
