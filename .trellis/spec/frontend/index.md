# Frontend Development Guidelines

> Best practices for frontend development in this project.

---

## Overview

The frontend is a React 19 SPA built with Vite and TypeScript, located in `web/src/`. It uses shadcn/ui components (built on Radix UI), Tailwind CSS for styling, lucide-react for icons, and TanStack Query for server state. The build output is compiled into `memoria/static/` and served by the FastAPI backend. The app talks to the backend exclusively through the typed API layer in `web/src/api.ts`.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Component Patterns](./component-patterns.md) | React components, state management, data fetching | Filled |
| [Styling and UI](./styling-ui.md) | Tailwind, shadcn/ui, icons, layout | Filled |
| [API Layer](./api-layer.md) | Typed fetch wrapper, query and mutation patterns | Filled |

---

## Tech Stack

- Framework: React 19 + TypeScript
- Build: Vite 8 (`tsc -b && vite build`), lint with oxlint
- Styling: Tailwind CSS 3.4 + tailwindcss-animate
- UI components: shadcn/ui pattern (Radix UI primitives + CVA variants + cn() merge)
- Icons: lucide-react
- Server state: TanStack Query v5 (useQuery, useMutation)
- Routing: react-router-dom v7 (BrowserRouter + Layout + nested Routes)
- Markdown: react-markdown v9 with custom Components

---

## Pre-Development Checklist

Before writing frontend code, check:

1. Is there an existing UI component in `web/src/components/ui/` for what you need?
2. Is the API function already declared in `web/src/api.ts`?
3. Are you using TanStack Query for server state, not local useState?
4. Are you importing icons from lucide-react?
5. Are you using Tailwind classes for styling, not inline styles?

---

**Language**: All documentation should be written in **English**.
