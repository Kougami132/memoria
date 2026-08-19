import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Activity, AlertCircle, Bot, BookOpen, BrainCircuit, ChevronDown, ChevronUp, Clock3, Cpu, FileJson, Pencil, Plus, Send, Sparkles, Trash2, Wrench } from 'lucide-react'
import * as api from '@/api'
import type { Source } from '@/api'

const mdComponents: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 list-disc space-y-0.5 pl-4">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal space-y-0.5 pl-4">{children}</ol>,
  code: ({ className, children, node: _node, ...props }) => {
    const isInline = !className
    return isInline
      ? <code className="rounded bg-muted px-1 font-mono text-xs" {...props}>{children}</code>
      : <code className="block" {...props}>{children}</code>
  },
  pre: ({ children }) => <pre className="mb-2 overflow-x-auto rounded-xl bg-muted p-3 font-mono text-xs">{children}</pre>,
  h1: ({ children }) => <h1 className="mb-1 mt-3 text-base font-semibold">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-1 mt-3 text-sm font-semibold">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1 mt-2 text-sm font-semibold">{children}</h3>,
  a: ({ href, children }) => <a href={href} className="text-primary underline" target="_blank" rel="noreferrer">{children}</a>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
}

interface DisplayMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources?: Source[]
  usedKbs?: string[]
  trace?: api.AgentTrace | null
}

function SourceList({ sources, getKnowledgeBaseName }: { sources: Source[]; getKnowledgeBaseName: (id: string) => string }) {
  const [open, setOpen] = useState(false)
  if (!sources.length) return null

  return (
    <div className="ml-1 mt-2">
      <button
        className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => setOpen(value => !value)}
      >
        <BookOpen className="h-3 w-3" />
        <span>检索依据 ({sources.length})</span>
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {sources.map((source, index) => (
            <div key={`${source.kb_id || 'kb'}-${source.doc_id}-${index}`} className="space-y-1.5 rounded-xl border bg-card px-3 py-2.5 text-xs shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="block truncate font-mono text-muted-foreground">
                    {source.source === 'vault' && source.filename ? source.filename : source.doc_id}
                  </span>
                  {source.kb_id && <span className="block truncate text-muted-foreground/70">知识库：{getKnowledgeBaseName(source.kb_id)}</span>}
                  {source.source === 'vault' && source.path && (
                    <span className="block truncate font-mono text-xs text-muted-foreground/70">{source.path}</span>
                  )}
                </div>
                <Badge variant="outline" className="shrink-0 text-xs font-normal">
                  相关度 {(source.score * 100).toFixed(0)}%
                </Badge>
              </div>
              <p className="line-clamp-2 leading-relaxed text-muted-foreground">{source.text}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function UsedKnowledgeBases({ ids, getKnowledgeBaseName }: { ids: string[]; getKnowledgeBaseName: (id: string) => string }) {
  if (!ids.length) return null
  return (
    <div className="mt-2 ml-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <span className="font-medium">使用知识库：</span>
      {ids.map(id => <Badge key={id} variant="secondary" className="font-normal">{getKnowledgeBaseName(id)}</Badge>)}
    </div>
  )
}


function formatDuration(ms?: number | null) {
  if (ms == null) return '—'
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

function formatTraceJson(value: unknown) {
  if (value == null) return ''
  const formatted = JSON.stringify(value, null, 2)
  if (!formatted || formatted === '{}' || formatted === '[]') return ''
  return formatted.length > 1200 ? `${formatted.slice(0, 1200)}…` : formatted
}

function TraceSpanIcon({ type, hasError }: { type: string; hasError: boolean }) {
  if (hasError) return <AlertCircle className="h-3.5 w-3.5 text-destructive" />
  if (type === 'function') return <Wrench className="h-3.5 w-3.5 text-blue-500" />
  if (type === 'generation' || type === 'response') return <Cpu className="h-3.5 w-3.5 text-purple-500" />
  if (type === 'agent') return <Bot className="h-3.5 w-3.5 text-emerald-500" />
  return <FileJson className="h-3.5 w-3.5 text-muted-foreground" />
}

function TracePanel({ trace }: { trace: api.AgentTrace }) {
  const [open, setOpen] = useState(false)
  const summary = trace.summary
  const spans = trace.spans || []
  const hasErrors = (summary?.error_count || 0) > 0

  return (
    <div className="ml-1 mt-2">
      <button
        className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => setOpen(value => !value)}
      >
        <Activity className="h-3 w-3" />
        <span>执行轨迹 / Trace</span>
        <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal">{summary?.span_count ?? spans.length} steps</Badge>
        <span className="inline-flex items-center gap-1"><Clock3 className="h-3 w-3" />{formatDuration(summary?.duration_ms)}</span>
        {summary?.tool_count ? <span>工具 {summary.tool_count}</span> : null}
        {summary?.model_count ? <span>模型 {summary.model_count}</span> : null}
        {hasErrors ? <span className="text-destructive">错误 {summary.error_count}</span> : null}
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {open && (
        <div className="mt-2 space-y-2 rounded-xl border bg-muted/20 p-2 text-xs shadow-sm">
          <div className="flex flex-wrap gap-x-4 gap-y-1 px-1 text-muted-foreground">
            <span>Trace ID: <code className="font-mono">{trace.trace_id}</code></span>
            {trace.workflow_name && <span>Workflow: {trace.workflow_name}</span>}
          </div>
          {spans.length ? (
            <div className="space-y-1.5">
              {spans.map((span, index) => {
                const dataJson = formatTraceJson(span.data)
                const errorJson = formatTraceJson(span.error)
                return (
                  <div key={span.id || `${span.name}-${index}`} className="rounded-lg border bg-card px-2.5 py-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <TraceSpanIcon type={span.type} hasError={Boolean(span.error)} />
                        <span className="truncate font-medium">{span.name}</span>
                        <Badge variant="secondary" className="px-1.5 py-0 text-[10px] font-normal">{span.type}</Badge>
                      </div>
                      <span className="shrink-0 text-muted-foreground">{formatDuration(span.duration_ms)}</span>
                    </div>
                    {errorJson && <pre className="mt-2 overflow-x-auto rounded bg-destructive/10 p-2 font-mono text-[11px] text-destructive">{errorJson}</pre>}
                    {dataJson && <pre className="mt-2 max-h-44 overflow-auto rounded bg-muted p-2 font-mono text-[11px] text-muted-foreground">{dataJson}</pre>}
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="px-1 py-2 text-muted-foreground">本次运行没有可展示的 span。</p>
          )}
        </div>
      )}
    </div>
  )
}

export default function AgenticChat() {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [input, setInput] = useState('')
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [skipRenameSave, setSkipRenameSave] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const { data: sessions = [], refetch: refetchSessions } = useQuery({
    queryKey: ['agent-sessions'],
    queryFn: api.listAgentSessions,
  })
  const { data: knowledgeBases = [] } = useQuery({
    queryKey: ['knowledge-bases'],
    queryFn: api.listKBs,
  })
  const knowledgeBaseNameById = useMemo(
    () => new Map(knowledgeBases.map(kb => [kb.id, kb.name])),
    [knowledgeBases],
  )
  const getKnowledgeBaseName = (id: string) => knowledgeBaseNameById.get(id) ?? id

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sessionTitle = (session: api.Session) => session.title?.trim() || '新对话'

  const clearRename = () => {
    setEditingSessionId(null)
    setEditingTitle('')
  }

  const loadSession = async (sid: string) => {
    setSessionId(sid)
    clearRename()
    try {
      const loaded = await api.getAgentMessages(sid)
      setMessages(loaded.map(message => ({
        id: message.id,
        role: message.role,
        content: message.content,
        sources: message.sources,
        usedKbs: message.role === 'assistant'
          ? [...new Set(message.sources.flatMap(source => source.kb_id ? [source.kb_id] : []))]
          : undefined,
        trace: message.trace,
      })))
    } catch {
      setMessages([])
    }
  }

  const newSession = () => {
    setSessionId(null)
    setMessages([])
    clearRename()
    inputRef.current?.focus()
  }

  const renameSessionMutation = useMutation({
    mutationFn: ({ sid, title }: { sid: string; title: string }) => api.updateAgentSession(sid, { title }),
    onSuccess: () => refetchSessions(),
    onError: () => refetchSessions(),
  })

  const finishRename = () => {
    if (skipRenameSave) {
      setSkipRenameSave(false)
      return
    }
    if (!editingSessionId) return
    const sid = editingSessionId
    const title = editingTitle.trim()
    const previous = sessions.find(session => session.id === sid)
    clearRename()
    if (!title || (previous && sessionTitle(previous) === title)) return
    renameSessionMutation.mutate({ sid, title })
  }

  const sendMutation = useMutation({
    mutationFn: ({ message }: { message: string }) => api.agentChat(message, sessionId ?? undefined),
    onMutate: ({ message }) => {
      setMessages(previous => [
        ...previous,
        { id: `user-${crypto.randomUUID()}`, role: 'user', content: message },
        { id: `assistant-${crypto.randomUUID()}`, role: 'assistant', content: '' },
      ])
      setInput('')
    },
    onSuccess: response => {
      setSessionId(response.session_id)
      setMessages(previous => {
        const next = [...previous]
        const assistant = next[next.length - 1]
        if (assistant?.role === 'assistant') {
          assistant.content = response.answer
          assistant.sources = response.sources
          assistant.usedKbs = response.used_kbs
          assistant.trace = response.trace
        }
        return next
      })
      refetchSessions()
    },
    onError: (_error, variables) => {
      setMessages(previous => previous.slice(0, -2))
      setInput(variables.message)
    },
  })

  const deleteSessionMutation = useMutation({
    mutationFn: (sid: string) => api.deleteAgentSession(sid),
    onSuccess: (_data, sid) => {
      if (sid === sessionId) newSession()
      refetchSessions()
    },
    onError: () => refetchSessions(),
  })

  const startRename = (session: api.Session) => {
    setEditingSessionId(session.id)
    setEditingTitle(sessionTitle(session))
  }

  const cancelRename = () => {
    setSkipRenameSave(true)
    clearRename()
    window.setTimeout(() => setSkipRenameSave(false), 0)
  }

  const handleSend = () => {
    const message = input.trim()
    if (!message || sendMutation.isPending) return
    sendMutation.mutate({ message })
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey && input.trim() && !sendMutation.isPending) {
      event.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex h-full">
      <div className="flex w-52 shrink-0 flex-col border-r bg-muted/20">
        <div className="space-y-2 border-b p-3">
          <div className="flex items-center gap-2 px-1 py-1 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-purple-500" />
            Agentic RAG
          </div>
          <p className="px-1 text-xs leading-relaxed text-muted-foreground">Agent 可自主选择系统中的知识库</p>
          <Button variant="outline" size="sm" className="h-8 w-full gap-1.5 text-xs" onClick={newSession} disabled={sendMutation.isPending}>
            <Plus className="h-3.5 w-3.5" />
            新建对话
          </Button>
        </div>
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
          {sessions.length === 0 && <p className="py-6 text-center text-xs text-muted-foreground">暂无历史会话</p>}
          {sessions.map(session => (
            <div
              key={session.id}
              className={`group relative w-full rounded-xl text-xs transition-colors ${session.id === sessionId ? 'bg-gradient-to-r from-purple-600/90 to-blue-500/90 text-white shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
            >
              {editingSessionId === session.id ? (
                <div className="px-3 py-2.5" onClick={event => event.stopPropagation()}>
                  <Input
                    autoFocus
                    value={editingTitle}
                    onChange={event => setEditingTitle(event.target.value)}
                    onFocus={event => event.currentTarget.select()}
                    onBlur={finishRename}
                    onKeyDown={event => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        event.currentTarget.blur()
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        cancelRename()
                      }
                    }}
                    disabled={renameSessionMutation.isPending}
                    className="h-6 rounded-lg bg-background px-2 py-0 text-xs text-foreground"
                  />
                  <p className="mt-1 opacity-60">{session.created_at.slice(0, 16).replace('T', ' ')}</p>
                </div>
              ) : (
                <>
                  <button className="w-full px-3 py-3 text-left disabled:cursor-not-allowed" onClick={() => loadSession(session.id)} disabled={sendMutation.isPending}>
                    <p className="truncate pr-12 font-medium">{sessionTitle(session)}</p>
                    <p className="mt-0.5 opacity-60">{session.created_at.slice(0, 16).replace('T', ' ')}</p>
                  </button>
                  <button
                    className={`absolute right-7 top-1/2 -translate-y-1/2 rounded p-1 opacity-0 transition-opacity group-hover:opacity-100 ${session.id === sessionId ? 'hover:bg-white/20' : 'hover:bg-black/10'}`}
                    onClick={event => { event.stopPropagation(); startRename(session) }}
                    disabled={renameSessionMutation.isPending || sendMutation.isPending}
                    aria-label="重命名会话"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    className={`absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 opacity-0 transition-opacity group-hover:opacity-100 ${session.id === sessionId ? 'hover:bg-white/20' : 'hover:bg-black/10'}`}
                    onClick={event => { event.stopPropagation(); deleteSessionMutation.mutate(session.id) }}
                    disabled={deleteSessionMutation.isPending || sendMutation.isPending}
                    aria-label="删除会话"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b bg-background/80 px-6 py-3 backdrop-blur-sm">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-blue-500 shadow-sm">
            <BrainCircuit className="h-4 w-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold">Agentic RAG</p>
            <p className="text-xs text-muted-foreground">跨知识库自主检索与回答</p>
          </div>
        </div>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
          {messages.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="mb-4 rounded-2xl bg-gradient-to-br from-purple-500/10 to-blue-500/10 p-5">
                <BrainCircuit className="h-10 w-10 text-purple-500" />
              </div>
              <p className="font-medium">向 Agent 提问</p>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">它会先了解可用知识库，再自主选择相关知识进行检索。</p>
            </div>
          )}
          {messages.map((message, index) => (
            <div key={message.id || index} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {message.role === 'assistant' ? (
                <div className="flex max-w-[78%] items-start gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-blue-500 shadow-sm">
                    <BrainCircuit className="h-4 w-4 text-white" />
                  </div>
                  <div>
                    <div className="mb-2 flex items-center gap-2">
                      <Badge variant="outline" className="gap-1 text-xs font-normal"><Sparkles className="h-3 w-3" />Agentic</Badge>
                    </div>
                    <div className="rounded-2xl rounded-tl-sm border bg-card px-4 py-3 text-sm leading-relaxed shadow-sm">
                      {message.content
                        ? <ReactMarkdown components={mdComponents}>{message.content}</ReactMarkdown>
                        : <span className="text-sm text-muted-foreground">正在思考并检索知识库…</span>}
                    </div>
                    <UsedKnowledgeBases ids={message.usedKbs || []} getKnowledgeBaseName={getKnowledgeBaseName} />
                    {message.sources && <SourceList sources={message.sources} getKnowledgeBaseName={getKnowledgeBaseName} />}
                    {message.trace && <TracePanel trace={message.trace} />}
                  </div>
                </div>
              ) : (
                <div className="max-w-[78%]">
                  <div className="whitespace-pre-wrap rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm leading-relaxed text-primary-foreground">{message.content}</div>
                </div>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
        <div className="shrink-0 border-t bg-background/80 px-4 py-4 backdrop-blur-sm">
          <div className="mx-auto flex max-w-3xl gap-2">
            <Input
              ref={inputRef}
              placeholder="输入问题，按 Enter 发送…"
              value={input}
              onChange={event => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              disabled={sendMutation.isPending}
              className="rounded-2xl text-sm"
            />
            <Button variant="gradient" onClick={handleSend} disabled={!input.trim() || sendMutation.isPending} className="shrink-0 rounded-2xl px-4">
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

