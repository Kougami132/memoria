---
change: refine-web-ui
design-doc: docs/superpowers/specs/2026-06-28-refine-web-ui-design.md
base-ref: 9ccee10cc041d820ba6b855a615150a433b9f08c
---

# Memoria Web UI 精致化 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**目标：** 对 Memoria 全部 Web 页面做视觉精致化，引入品牌渐变色、重设计 Sidebar、优化 Chat 页面消息结构与等待动画、统一卡片交互与空状态，不改动任何 API/后端逻辑。

**架构：** 纯前端样式层变更，分 7 个独立 task 逐层推进。先建立基础 token（CSS 变量 + Tailwind brand color），再往上叠加组件级改动。每个 task 都可在 `npm run build` 无报错的前提下独立验收。

**技术栈：** React 18 + TypeScript + Vite + TailwindCSS + shadcn/ui（class-variance-authority）+ lucide-react

## 全局约束

- 构建命令：`cd N:/Data/Projects/memoria/web && npm run build`（必须零错误、零 TypeScript 类型错误）
- 仅修改 JSX/className/CSS，**不触碰任何 state、mutation、API 调用逻辑**
- 现有 oklch CSS 变量（`--primary`、`--background` 等）保持不变，只做叠加
- 新增 gradient variant 不得修改 button.tsx 中已有的 `default`、`outline`、`ghost` 等 variant
- 所有 UI 文字必须为中文；placeholder 已为中文，不得改回英文
- 每个 task 完成后立即 commit，不积压

---

## 文件改动总览

| 文件 | Task | 改动类型 |
|------|------|---------|
| `web/index.html` | 1 | Modify — `<title>` 改为 Memoria |
| `web/tailwind.config.js` | 1 | Modify — 扩展 `colors.brand` |
| `web/src/index.css` | 1 | Modify — 新增渐变 CSS 变量 + `@keyframes bounce-dot` |
| `web/src/components/ui/button.tsx` | 2 | Modify — 新增 `gradient` variant |
| `web/src/components/Layout.tsx` | 3 | Modify — Sidebar 全面重设计 |
| `web/src/pages/Chat.tsx` | 4 | Modify — 消息气泡、等待动画、输入区、会话列表、空状态 |
| `web/src/pages/KnowledgeBases.tsx` | 5 | Modify — Empty state、卡片 hover、主按钮 gradient |
| `web/src/pages/Bots.tsx` | 6 | Modify — Empty state、卡片 hover、主按钮 gradient |
| `web/src/pages/Settings.tsx` | 7 | Modify — 保存按钮 gradient、CardTitle 字重、已保存绿色渐变 |

---

### Task 1：基础样式 Token（index.html + tailwind.config.js + index.css）

**文件：**
- Modify: `web/index.html`
- Modify: `web/tailwind.config.js`
- Modify: `web/src/index.css`

**接口：**
- 产出：
  - CSS 类 `.dot-1`、`.dot-2`、`.dot-3`（供 Task 4 Chat 页面三点动画使用）
  - Tailwind 类 `from-brand-from`、`to-brand-to`（供 Task 2–7 渐变色使用，通过 `colors.brand` 定义）
  - CSS 变量 `--gradient-sidebar`、`--gradient-primary`（备用，供 Layout 直接引用）

- [x] **步骤 1：修改 `web/index.html`，将 title 改为 Memoria**

  将第 7 行：
  ```html
  <title>web</title>
  ```
  改为：
  ```html
  <title>Memoria</title>
  ```

- [x] **步骤 2：在 `web/tailwind.config.js` 的 `theme.extend.colors` 中追加 brand token**

  在第 32 行 `colors: {` 块内，现有 `background:` 之前插入：
  ```js
  brand: {
    from: '#9333ea',  // purple-600
    to:   '#3b82f6',  // blue-500
  },
  ```

  修改后 `colors` 块起始结构应为：
  ```js
  colors: {
    brand: {
      from: '#9333ea',
      to:   '#3b82f6',
    },
    background: 'var(--background)',
    // ... 其余不变
  ```

- [x] **步骤 3：在 `web/src/index.css` 的 `:root` 块末尾追加渐变 CSS 变量**

  在 `:root { ... }` 块中，`--radius: 0.625rem;` 之后、`}` 之前插入：
  ```css
  --gradient-sidebar: linear-gradient(to bottom, #0f172a, #3b0764, #0f172a);
  --gradient-primary: linear-gradient(to right, #9333ea, #3b82f6);
  ```

- [x] **步骤 4：在 `web/src/index.css` 末尾（`}` 之后）追加 bounce-dot 动画**

  在文件末尾追加：
  ```css
  @keyframes bounce-dot {
    0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
    40%           { transform: translateY(-6px); opacity: 1; }
  }
  .dot-1 { animation: bounce-dot 1.2s infinite 0ms; }
  .dot-2 { animation: bounce-dot 1.2s infinite 150ms; }
  .dot-3 { animation: bounce-dot 1.2s infinite 300ms; }
  ```

- [x] **步骤 5：验证构建通过**

  ```bash
  cd N:/Data/Projects/memoria/web && npm run build
  ```
  预期：`✓ built in` 字样，无报错，无 TypeScript 错误。

- [x] **步骤 6：Commit**

  ```bash
  cd N:/Data/Projects/memoria
  git add web/index.html web/tailwind.config.js web/src/index.css
  git commit -m "feat(ui): 添加品牌色 token、渐变变量与三点跳动动画"
  ```

---

### Task 2：渐变按钮 Variant（button.tsx）

**文件：**
- Modify: `web/src/components/ui/button.tsx`

**接口：**
- 消费：Task 1 产出的 Tailwind `from-purple-600`、`to-blue-500` 类（原生 Tailwind 颜色，无需 brand token）
- 产出：`variant="gradient"` 可在任意 `<Button>` 上使用，不影响已有 variant

- [x] **步骤 1：在 button.tsx 的 `variants.variant` 对象中追加 gradient 项**

  在第 21 行 `link: "text-primary underline-offset-4 hover:underline",` 之后、第 22 行 `},` 之前插入：
  ```ts
  gradient: 'bg-gradient-to-r from-purple-600 to-blue-500 text-white shadow-sm hover:brightness-110 hover:shadow-md transition-all',
  ```

  修改后 `variant` 对象完整内容：
  ```ts
  variant: {
    default:
      "bg-primary text-primary-foreground shadow hover:bg-primary/90",
    destructive:
      "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
    outline:
      "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground",
    secondary:
      "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
    ghost: "hover:bg-accent hover:text-accent-foreground",
    link: "text-primary underline-offset-4 hover:underline",
    gradient: 'bg-gradient-to-r from-purple-600 to-blue-500 text-white shadow-sm hover:brightness-110 hover:shadow-md transition-all',
  },
  ```

- [x] **步骤 2：验证构建通过**

  ```bash
  cd N:/Data/Projects/memoria/web && npm run build
  ```
  预期：无报错。TypeScript 应正确推断 `variant` 联合类型包含 `'gradient'`。

- [x] **步骤 3：Commit**

  ```bash
  cd N:/Data/Projects/memoria
  git add web/src/components/ui/button.tsx
  git commit -m "feat(ui): button 新增 gradient variant"
  ```

---

### Task 3：Sidebar 重设计（Layout.tsx）

**文件：**
- Modify: `web/src/components/Layout.tsx`

**接口：**
- 消费：Task 1 的 Tailwind 颜色类（`from-slate-900`、`via-purple-950`、`to-slate-900`、`from-purple-500`、`to-blue-500` 均为原生 Tailwind）
- 产出：深色渐变 Sidebar，当前 active 路由高亮白色半透明块，底部版权文字半透明白色

- [x] **步骤 1：完整替换 `web/src/components/Layout.tsx`**

  用以下内容覆盖整个文件：
  ```tsx
  import { NavLink, Outlet } from 'react-router-dom'
  import { Brain, Database, Bot, MessageSquare, Settings } from 'lucide-react'

  const links = [
    { to: '/knowledge-bases', label: '知识库', icon: Database },
    { to: '/bots', label: '机器人', icon: Bot },
    { to: '/chat', label: '对话', icon: MessageSquare },
    { to: '/settings', label: '设置', icon: Settings },
  ]

  export default function Layout() {
    return (
      <div className="flex h-screen bg-background">
        <aside className="w-60 flex flex-col shrink-0 bg-gradient-to-b from-slate-900 via-purple-950 to-slate-900">
          <div className="flex items-center gap-2.5 px-5 h-14 shrink-0">
            <div className="bg-gradient-to-br from-purple-500 to-blue-500 rounded-xl p-1.5 shrink-0">
              <Brain className="h-4 w-4 text-white" />
            </div>
            <span className="font-bold text-base tracking-tight text-white">Memoria</span>
          </div>
          <nav className="flex-1 p-3 space-y-0.5">
            {links.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-white/15 text-white'
                      : 'text-white/60 hover:text-white hover:bg-white/10'
                  }`
                }
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </NavLink>
            ))}
          </nav>
          <div className="px-5 py-3 shrink-0">
            <p className="text-xs text-white/30">RAG 记忆系统  v0.1</p>
          </div>
        </aside>
        <main className="flex-1 min-h-0 overflow-auto">
          <Outlet />
        </main>
      </div>
    )
  }
  ```

- [x] **步骤 2：验证构建通过**

  ```bash
  cd N:/Data/Projects/memoria/web && npm run build
  ```
  预期：无报错。

- [x] **步骤 3：Commit**

  ```bash
  cd N:/Data/Projects/memoria
  git add web/src/components/Layout.tsx
  git commit -m "feat(ui): Sidebar 重设计 — 深色渐变背景、白色导航项"
  ```

---

### Task 4：Chat 页面重设计（Chat.tsx）

**文件：**
- Modify: `web/src/pages/Chat.tsx`

**接口：**
- 消费：
  - Task 1 的 `.dot-1`、`.dot-2`、`.dot-3` CSS 类（三点跳动动画）
  - Task 2 的 `variant="gradient"` Button
- 产出：助手消息带渐变圆形头像、等待时三点跳动、输入区 backdrop-blur、会话列表项渐变 active 状态、空状态彩色图标

- [x] **步骤 1：完整替换 `web/src/pages/Chat.tsx`**

  用以下内容覆盖整个文件：
  ```tsx
  import { useState, useRef, useEffect } from 'react'
  import { useQuery, useMutation } from '@tanstack/react-query'
  import { Button } from '@/components/ui/button'
  import { Input } from '@/components/ui/input'
  import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
  import { Badge } from '@/components/ui/badge'
  import { Send, Plus, ChevronDown, ChevronUp, MessageSquare, BookOpen, Brain } from 'lucide-react'
  import * as api from '@/api'
  import type { Source } from '@/api'

  interface DisplayMessage {
    role: 'user' | 'assistant'
    content: string
    sources?: Source[]
  }

  function SourceList({ sources }: { sources: Source[] }) {
    const [open, setOpen] = useState(false)
    if (!sources.length) return null
    return (
      <div className="mt-2 ml-1">
        <button
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setOpen(v => !v)}
        >
          <BookOpen className="h-3 w-3" />
          <span>参考来源 ({sources.length})</span>
          {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
        {open && (
          <div className="mt-2 space-y-2">
            {sources.map((s, i) => (
              <div key={i} className="rounded-xl border bg-card px-3 py-2.5 text-xs space-y-1.5 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-muted-foreground truncate">{s.doc_id}</span>
                  <Badge variant="outline" className="text-xs shrink-0 font-normal">
                    相关度 {(s.score * 100).toFixed(0)}%
                  </Badge>
                </div>
                <p className="text-muted-foreground line-clamp-2 leading-relaxed">{s.text}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  export default function Chat() {
    const { data: bots = [] } = useQuery({ queryKey: ['bots'], queryFn: api.listBots })
    const [botId, setBotId] = useState<string>('')
    const [sessionId, setSessionId] = useState<string | null>(null)
    const [messages, setMessages] = useState<DisplayMessage[]>([])
    const [input, setInput] = useState('')
    const bottomRef = useRef<HTMLDivElement>(null)
    const inputRef = useRef<HTMLInputElement>(null)

    const { data: sessions = [], refetch: refetchSessions } = useQuery({
      queryKey: ['sessions', botId],
      queryFn: () => api.listSessions(botId),
      enabled: !!botId,
    })

    useEffect(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages])

    const loadSession = async (sid: string) => {
      setSessionId(sid)
      const msgs = await api.getMessages(sid)
      setMessages(msgs.map(m => ({ role: m.role, content: m.content })))
    }

    const newSession = () => {
      setSessionId(null)
      setMessages([])
      inputRef.current?.focus()
    }

    const sendMsg = useMutation({
      mutationFn: () => api.chat(botId, input, sessionId ?? undefined),
      onMutate: () => {
        setMessages(prev => [...prev, { role: 'user', content: input }])
        setInput('')
      },
      onSuccess: data => {
        if (!sessionId) { setSessionId(data.session_id); refetchSessions() }
        setMessages(prev => [...prev, { role: 'assistant', content: data.answer, sources: data.sources }])
      },
    })

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey && input.trim() && botId && !sendMsg.isPending) {
        e.preventDefault()
        sendMsg.mutate()
      }
    }

    return (
      <div className="flex h-full">
        {/* 左侧会话栏 */}
        <div className="w-52 border-r flex flex-col bg-muted/20 shrink-0">
          <div className="p-3 border-b space-y-2">
            <Select value={botId} onValueChange={id => { setBotId(id); setSessionId(null); setMessages([]) }}>
              <SelectTrigger className="bg-background text-sm h-9">
                <SelectValue placeholder="选择机器人" />
              </SelectTrigger>
              <SelectContent>
                {bots.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {botId && (
              <Button variant="outline" size="sm" className="w-full gap-1.5 h-8 text-xs" onClick={newSession}>
                <Plus className="h-3.5 w-3.5" />
                新建对话
              </Button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-0.5 min-h-0">
            {botId && sessions.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-6">暂无历史会话</p>
            )}
            {sessions.map((s, index) => (
              <button
                key={s.id}
                className={`w-full text-left rounded-xl px-3 py-3 text-xs transition-colors ${
                  s.id === sessionId
                    ? 'bg-gradient-to-r from-purple-600/90 to-blue-500/90 text-white shadow-sm'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
                onClick={() => loadSession(s.id)}
              >
                <p className="font-medium truncate">会话 {index + 1}</p>
                <p className="opacity-60 mt-0.5">{s.created_at.slice(0, 16).replace('T', ' ')}</p>
              </button>
            ))}
          </div>
        </div>

        {/* 主聊天区 */}
        <div className="flex-1 flex flex-col min-w-0">
          {!botId ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
              <div className="bg-gradient-to-br from-purple-500/10 to-blue-500/10 rounded-2xl p-5 mb-4 inline-block">
                <MessageSquare className="h-10 w-10 text-purple-500" />
              </div>
              <p className="font-medium">从左侧选择机器人开始对话</p>
              <p className="text-sm text-muted-foreground mt-1">机器人将基于关联知识库进行 RAG 检索</p>
            </div>
          ) : (
            <>
              <div className="flex-1 overflow-y-auto p-6 space-y-5 min-h-0">
                {messages.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full text-center">
                    <p className="text-muted-foreground text-sm">发送消息开始对话</p>
                    <p className="text-xs text-muted-foreground mt-1">机器人将自动检索相关知识库内容作为参考</p>
                  </div>
                )}
                {messages.map((m, i) => (
                  <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    {m.role === 'assistant' ? (
                      <div className="flex items-start gap-3 max-w-[75%]">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center shrink-0 shadow-sm">
                          <Brain className="h-4 w-4 text-white" />
                        </div>
                        <div>
                          <div className="rounded-2xl rounded-tl-sm bg-white border px-4 py-3 text-sm leading-relaxed shadow-sm whitespace-pre-wrap">
                            {m.content}
                          </div>
                          {m.sources && <SourceList sources={m.sources} />}
                        </div>
                      </div>
                    ) : (
                      <div className="max-w-[75%]">
                        <div className="rounded-2xl rounded-br-sm bg-primary text-primary-foreground px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap">
                          {m.content}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                {sendMsg.isPending && (
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center shrink-0">
                      <Brain className="h-4 w-4 text-white" />
                    </div>
                    <div className="bg-white border rounded-2xl rounded-tl-sm px-4 py-3.5 shadow-sm">
                      <div className="flex gap-1.5 items-center h-5">
                        <span className="w-1.5 h-1.5 rounded-full bg-purple-400 dot-1" />
                        <span className="w-1.5 h-1.5 rounded-full bg-purple-400 dot-2" />
                        <span className="w-1.5 h-1.5 rounded-full bg-purple-400 dot-3" />
                      </div>
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>
              <div className="border-t bg-background/80 backdrop-blur-sm px-4 py-4 shrink-0">
                <div className="flex gap-2 max-w-3xl mx-auto">
                  <Input
                    ref={inputRef}
                    placeholder="输入消息，按 Enter 发送…"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={sendMsg.isPending}
                    className="rounded-2xl text-sm"
                  />
                  <Button
                    variant="gradient"
                    onClick={() => sendMsg.mutate()}
                    disabled={!input.trim() || sendMsg.isPending}
                    className="rounded-2xl px-4 shrink-0"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    )
  }
  ```

- [x] **步骤 2：验证构建通过**

  ```bash
  cd N:/Data/Projects/memoria/web && npm run build
  ```
  预期：无报错。Brain 图标需从 lucide-react import，已在 import 行第 7 行加入。

- [x] **步骤 3：Commit**

  ```bash
  cd N:/Data/Projects/memoria
  git add web/src/pages/Chat.tsx
  git commit -m "feat(ui): Chat 页面 — 渐变头像、三点等待动画、backdrop-blur 输入区、渐变会话项"
  ```

---

### Task 5：知识库页面精致化（KnowledgeBases.tsx）

**文件：**
- Modify: `web/src/pages/KnowledgeBases.tsx`

**接口：**
- 消费：Task 2 的 `variant="gradient"` Button
- 产出：彩色 Empty state、卡片 hover 上浮阴影、文档项 hover 背景加强、文件图标主色

- [x] **步骤 1：修改 Empty state（第 147–151 行）**

  将：
  ```tsx
  {kbs.length === 0 ? (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <Database className="h-12 w-12 text-muted-foreground/25 mb-4" />
      <p className="font-medium text-muted-foreground">暂无知识库</p>
      <p className="text-sm text-muted-foreground mt-1">点击右上角「新建知识库」开始</p>
    </div>
  ```
  改为：
  ```tsx
  {kbs.length === 0 ? (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="bg-gradient-to-br from-purple-500/10 to-blue-500/10 rounded-2xl p-5 mb-4 inline-block">
        <Database className="h-10 w-10 text-purple-500" />
      </div>
      <p className="font-medium">暂无知识库</p>
      <p className="text-sm text-muted-foreground mt-1">点击右上角「新建知识库」开始</p>
    </div>
  ```

- [x] **步骤 2：修改主 CTA 按钮为 gradient variant（第 113 行）**

  将：
  ```tsx
  <Button onClick={() => setShowForm(v => !v)} className="gap-2 shrink-0">
  ```
  改为：
  ```tsx
  <Button variant="gradient" onClick={() => setShowForm(v => !v)} className="gap-2 shrink-0">
  ```

- [x] **步骤 3：为知识库卡片添加 hover 上浮效果（第 155 行）**

  将：
  ```tsx
  <Card key={kb.id} className="overflow-hidden">
  ```
  改为：
  ```tsx
  <Card key={kb.id} className="overflow-hidden transition-all hover:shadow-md hover:-translate-y-0.5">
  ```

- [x] **步骤 4：加强文档列表项 hover 背景与文件图标主色（DocList 函数内，第 52–56 行）**

  将：
  ```tsx
  <div key={doc.id} className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2">
    <div className="flex items-center gap-2 min-w-0">
      <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
  ```
  改为：
  ```tsx
  <div key={doc.id} className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2 transition-colors hover:bg-muted/60">
    <div className="flex items-center gap-2 min-w-0">
      <FileText className="h-4 w-4 text-purple-500 shrink-0" />
  ```

- [x] **步骤 5：验证构建通过**

  ```bash
  cd N:/Data/Projects/memoria/web && npm run build
  ```
  预期：无报错。

- [x] **步骤 6：Commit**

  ```bash
  cd N:/Data/Projects/memoria
  git add web/src/pages/KnowledgeBases.tsx
  git commit -m "feat(ui): 知识库页面 — 彩色空状态、渐变主按钮、卡片 hover 上浮"
  ```

---

### Task 6：机器人页面精致化（Bots.tsx）

**文件：**
- Modify: `web/src/pages/Bots.tsx`

**接口：**
- 消费：Task 2 的 `variant="gradient"` Button
- 产出：彩色 Empty state、卡片 hover 上浮阴影、Bot 图标主色渐变、关联知识库 checkbox 选中态更明显

- [x] **步骤 1：修改 Empty state（第 152–156 行）**

  将：
  ```tsx
  {bots.length === 0 ? (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <Bot className="h-12 w-12 text-muted-foreground/25 mb-4" />
      <p className="font-medium text-muted-foreground">暂无机器人</p>
      <p className="text-sm text-muted-foreground mt-1">点击右上角「新建机器人」开始</p>
    </div>
  ```
  改为：
  ```tsx
  {bots.length === 0 ? (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="bg-gradient-to-br from-purple-500/10 to-blue-500/10 rounded-2xl p-5 mb-4 inline-block">
        <Bot className="h-10 w-10 text-purple-500" />
      </div>
      <p className="font-medium">暂无机器人</p>
      <p className="text-sm text-muted-foreground mt-1">点击右上角「新建机器人」开始</p>
    </div>
  ```

- [x] **步骤 2：修改主 CTA 按钮为 gradient variant（第 132 行）**

  将：
  ```tsx
  <Button onClick={() => setShowCreate(v => !v)} className="gap-2 shrink-0">
  ```
  改为：
  ```tsx
  <Button variant="gradient" onClick={() => setShowCreate(v => !v)} className="gap-2 shrink-0">
  ```

- [x] **步骤 3：为机器人卡片添加 hover 上浮效果（第 160 行）**

  将：
  ```tsx
  <Card key={bot.id} className="overflow-hidden">
  ```
  改为：
  ```tsx
  <Card key={bot.id} className="overflow-hidden transition-all hover:shadow-md hover:-translate-y-0.5">
  ```

- [x] **步骤 4：加强 Bot 图标视觉（CardHeader 内，第 165 行）**

  将：
  ```tsx
  <Bot className="h-4 w-4 text-primary shrink-0" />
  ```
  改为：
  ```tsx
  <Bot className="h-4 w-4 text-purple-500 shrink-0" />
  ```

- [x] **步骤 5：加强知识库关联 checkbox 选中态（BotForm 内，第 56–65 行）**

  将：
  ```tsx
  <label
    key={kb.id}
    className="flex items-center gap-2.5 rounded-lg border px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors"
  >
    <Checkbox
      id={kb.id}
      checked={selectedKBs.has(kb.id)}
      onCheckedChange={() => toggleKB(kb.id)}
    />
    <span className="text-sm">{kb.name}</span>
  </label>
  ```
  改为：
  ```tsx
  <label
    key={kb.id}
    className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
      selectedKBs.has(kb.id)
        ? 'border-purple-400/60 bg-purple-500/5'
        : 'hover:bg-muted/50'
    }`}
  >
    <Checkbox
      id={kb.id}
      checked={selectedKBs.has(kb.id)}
      onCheckedChange={() => toggleKB(kb.id)}
    />
    <span className="text-sm">{kb.name}</span>
  </label>
  ```

- [x] **步骤 6：验证构建通过**

  ```bash
  cd N:/Data/Projects/memoria/web && npm run build
  ```
  预期：无报错。

- [x] **步骤 7：Commit**

  ```bash
  cd N:/Data/Projects/memoria
  git add web/src/pages/Bots.tsx
  git commit -m "feat(ui): 机器人页面 — 彩色空状态、渐变主按钮、卡片 hover 上浮、知识库选中高亮"
  ```

---

### Task 7：设置页面优化（Settings.tsx）

**文件：**
- Modify: `web/src/pages/Settings.tsx`

**接口：**
- 消费：Task 2 的 `variant="gradient"` Button
- 产出：保存按钮渐变色（已保存时绿色渐变）、CardTitle 字重加强

- [x] **步骤 1：修改保存按钮为 gradient variant，已保存时切换绿色渐变（第 149–157 行）**

  将：
  ```tsx
  <div className="flex items-center gap-3">
    <Button
      onClick={() => update.mutate()}
      disabled={update.isPending}
      className="gap-2"
    >
      {saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
      {update.isPending ? '保存中…' : saved ? '已保存' : '保存设置'}
    </Button>
  ```
  改为：
  ```tsx
  <div className="flex items-center gap-3">
    <Button
      variant="gradient"
      onClick={() => update.mutate()}
      disabled={update.isPending}
      className={`gap-2 ${saved ? 'from-green-500 to-emerald-400' : ''}`}
    >
      {saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
      {update.isPending ? '保存中…' : saved ? '已保存' : '保存设置'}
    </Button>
  ```

- [x] **步骤 2：加强 CardTitle 字重（两处，第 54 行和第 108 行）**

  将第一处：
  ```tsx
  <CardTitle className="text-base">API 配置</CardTitle>
  ```
  改为：
  ```tsx
  <CardTitle className="text-base font-semibold text-foreground">API 配置</CardTitle>
  ```

  将第二处：
  ```tsx
  <CardTitle className="text-base">RAG 参数</CardTitle>
  ```
  改为：
  ```tsx
  <CardTitle className="text-base font-semibold text-foreground">RAG 参数</CardTitle>
  ```

- [x] **步骤 3：验证构建通过**

  ```bash
  cd N:/Data/Projects/memoria/web && npm run build
  ```
  预期：无报错。

- [x] **步骤 4：Commit**

  ```bash
  cd N:/Data/Projects/memoria
  git add web/src/pages/Settings.tsx
  git commit -m "feat(ui): 设置页面 — 渐变保存按钮、已保存绿色渐变、CardTitle 字重加强"
  ```

---

## 验收清单（与 Design Doc §8 对齐）

完成所有 task 后，逐项确认：

- [x] `npm run build` 零报错、零 TypeScript 类型错误
- [x] Sidebar 显示深色渐变背景（slate-900 → purple-950 → slate-900），当前路由导航项白色半透明高亮
- [x] 所有主 CTA 按钮（新建知识库、新建机器人、保存设置、Chat 发送）呈现紫→蓝渐变
- [x] Chat 助手消息有渐变圆形头像（Brain 图标），等待时三点跳动动画（`dot-1/2/3`），输入区有 `backdrop-blur-sm` 效果
- [x] 知识库/机器人页面空状态：彩色渐变图标背景（`from-purple-500/10 to-blue-500/10`）+ 无颜色主标题
- [x] 全界面无英文 UI 文字残留（placeholder、button label、hint text 等均为中文）
- [x] 浏览器刷新页面 title 显示 "Memoria"
