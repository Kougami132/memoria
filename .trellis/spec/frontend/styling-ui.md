# Styling and UI

> Visual design conventions for the frontend.

---

## Overview

Styling is done entirely with Tailwind CSS utility classes. There are no CSS modules or styled-components. UI primitives follow the shadcn/ui pattern: Radix UI unstyled primitives wrapped with `class-variance-authority` (CVA) variants and merged with the `cn()` utility from `web/src/lib/utils.ts`.

---

## Tailwind

- Write styles as Tailwind class strings directly in JSX. Merge conditional classes with the `cn()` helper.
- Responsive: use Tailwind breakpoint prefixes (`sm:`, `md:`, `lg:`) as needed.
- Color tokens: use Tailwind theme tokens (`bg-background`, `text-foreground`, `bg-muted`, `text-muted-foreground`, `border`, `bg-card`, `bg-primary`, `text-primary`) rather than raw hex values.
- Do not use inline `style={{}}` props.

---

## shadcn/ui Components

Available primitives in `web/src/components/ui/`: button, card, input, select, badge, checkbox, label, textarea.

- Import from `@/components/ui/<name>`.
- Button variants: use the `variant` prop (default, outline, ghost, destructive) and `size` prop, defined via CVA in the component file.
- Select: import the full destructure `Select, SelectContent, SelectItem, SelectTrigger, SelectValue`.
- When a primitive is missing, add it by following the shadcn/ui convention (Radix primitive + CVA + cn).

---

## Icons

Use `lucide-react` for all icons. Import named icons and render as components with size classes.

```tsx
import { Brain, Database, Bot, MessageSquare, Settings } from 'lucide-react'
<Icon className="h-4 w-4 shrink-0" />
```

- Default icon size is `h-4 w-4` in navigation and controls.
- Use `shrink-0` on icons inside flex containers to prevent distortion.

---

## Layout

- The app shell is a fixed-height flex layout: a 240px (`w-60`) sidebar and a scrollable main area.
- Sidebar uses a dark gradient (`bg-gradient-to-b from-slate-900 via-purple-950 to-slate-900`) with `NavLink` items.
- Pages are rendered via `<Outlet />` inside the main area.
- Use `min-h-0` and `overflow-auto` on scroll containers to prevent flex blowout.

---

## Common Mistakes

1. **Using raw hex colors instead of theme tokens.** Always prefer `bg-background`, `text-foreground`, etc. so dark/light theming stays consistent.
2. **Forgetting `shrink-0` on icons in flex rows.** Without it, icons get squished when text is long.
3. **Adding a new CSS file.** All styling is Tailwind utilities; do not introduce external CSS or CSS modules.
4. **Not using `cn()` for conditional classes.** Avoid template-string concatenation for class lists; use `cn(base, conditional && 'extra')`.
