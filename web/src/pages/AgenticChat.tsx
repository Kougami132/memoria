import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import { Badge } from '@/components/ui/badge'
import { 
  Activity, 
  AlertCircle, 
  Bot, 
  BookOpen, 
  ChevronDown, 
  ChevronUp, 
  Clock3, 
  Cpu, 
  FileJson, 
  Pencil, 
  Plus, 
  ArrowUp, 
  Sparkles, 
  Trash2, 
  Wrench,
  Copy,
  Check,
  MessageSquarePlus,
  BrainCircuit
} from 'lucide-react'
import * as api from '@/api'
import type { Source } from '@/api'

const mdComponents: Components = {
  p:      ({ children }) => <p className="mb-3 leading-7 last:mb-0">{children}</p>,
  ul:     ({ children }) => <ul className="list-disc pl-5 mb-3 space-y-1">{children}</ul>,
  ol:     ({ children }) => <ol className="list-decimal pl-5 mb-3 space-y-1">{children}</ol>,
  li:     ({ children }) => <li className="leading-7">{children}</li>,
  code:   ({ className, children, node: _node, ...props }) => {
    const isInline = !className
    return isInline
      ? <code className="bg-muted text-foreground px-1.5 py-0.5 rounded font-mono text-[13px]" {...props}>{children}</code>
      : <code className="block text-sm" {...props}>{children}</code>
  },
  pre:    ({ children }) => (
    <pre className="bg-[#1e1e1e] text-[#d4d4d4] rounded-xl p-4 overflow-x-auto my-3 text-xs font-mono border border-border/40">
      {children}
    </pre>
  ),
  h1:     ({ children }) => <h1 className="font-semibold text-xl mt-5 mb-2">{children}</h1>,
  h2:     ({ children }) => <h2 className="font-semibold text-lg mt-4 mb-2">{children}</h2>,
  h3:     ({ children }) => <h3 className="font-semibold text-base mt-3 mb-1.5">{children}</h3>,
  blockquote: ({ children }) => <blockquote className="border-l-2 border-border pl-4 my-2 text-muted-foreground italic">{children}</blockquote>,
  a:      ({ href, children }) => <a href={href} className="text-blue-500 hover:underline underline-offset-4" target="_blank" rel="noreferrer">{children}</a>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
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
    <div className="mt-3">
      <button
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground bg-secondary/70 hover:bg-secondary px-2.5 py-1 rounded-lg border border-border/60 transition-colors"
        onClick={() => setOpen(value => !value)}
      >
        <BookOpen className="h-3.5 w-3.5" />
        <span>检索依据 ({sources.length})</span>
        {open ? <ChevronUp className="h-3 w-3 ml-0.5" /> : <ChevronDown className="h-3 w-3 ml-0.5" />}
      </button>
      {open && (
        <div className="mt-2.5 space-y-2 max-w-2xl">
          {sources.map((source, index) => (
            <div key={`${source.kb_id || 'kb'}-${source.doc_id}-${index}`} className="rounded-xl border border-border bg-card p-3 text-xs space-y-1.5 shadow-xs">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-medium text-foreground truncate block">
                    {source.source === 'vault' && source.filename ? source.filename : source.doc_id}
                  </span>
                  {source.kb_id && <span className="text-[11px] text-muted-foreground block truncate">知识库：{getKnowledgeBaseName(source.kb_id)}</span>}
                  {source.source === 'vault' && source.path && (
                    <span className="text-[11px] text-muted-foreground font-mono truncate block">{source.path}</span>
                  )}
                </div>
                <Badge variant="secondary" className="text-[11px] shrink-0 font-normal">
                  匹配度 {(source.score * 100).toFixed(0)}%
                </Badge>
              </div>
              <p className="text-muted-foreground line-clamp-3 leading-relaxed">{source.text}</p>
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
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <span className="text-[11px]">命中知识库：</span>
      {ids.map(id => (
        <Badge key={id} variant="secondary" className="font-normal text-[11px] px-2 py-0.5">
          {getKnowledgeBaseName(id)}
        </Badge>
      ))}
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
    <div className="mt-2.5">
      <button
        className="inline-flex flex-wrap items-center gap-2 text-xs text-muted-foreground hover:text-foreground bg-secondary/50 hover:bg-secondary px-2.5 py-1 rounded-lg border border-border/50 transition-colors"
        onClick={() => setOpen(value => !value)}
      >
        <Activity className="h-3.5 w-3.5 text-purple-500" />
        <span className="font-medium text-foreground">思考与执行轨迹</span>
        <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal">
          {summary?.span_count ?? spans.length} 步
        </Badge>
        <span className="inline-flex items-center gap-1 text-[11px]">
          <Clock3 className="h-3 w-3" />
          {formatDuration(summary?.duration_ms)}
        </span>
        {summary?.tool_count ? <span className="text-[11px]">工具 {summary.tool_count}</span> : null}
        {hasErrors ? <span className="text-destructive text-[11px]">异常 {summary.error_count}</span> : null}
        {open ? <ChevronUp className="h-3 w-3 ml-0.5" /> : <ChevronDown className="h-3 w-3 ml-0.5" />}
      </button>

      {open && (
        <div className="mt-2.5 space-y-2 rounded-xl border border-border bg-card/50 p-3 text-xs shadow-xs max-w-2xl">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-[11px] pb-1 border-b border-border/40">
            <span>Trace ID: <code className="font-mono">{trace.trace_id}</code></span>
            {trace.workflow_name && <span>Workflow: {trace.workflow_name}</span>}
          </div>
          {spans.length ? (
            <div className="space-y-1.5 pt-1">
              {spans.map((span, index) => {
                const dataJson = formatTraceJson(span.data)
                const errorJson = formatTraceJson(span.error)
                return (
                  <div key={span.id || `${span.name}-${index}`} className="rounded-lg border border-border bg-background p-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <TraceSpanIcon type={span.type} hasError={Boolean(span.error)} />
                        <span className="truncate font-medium text-foreground">{span.name}</span>
                        <Badge variant="secondary" className="px-1.5 py-0 text-[10px] font-normal">
                          {span.type}
                        </Badge>
                      </div>
                      <span className="shrink-0 text-muted-foreground text-[11px]">{formatDuration(span.duration_ms)}</span>
                    </div>
                    {errorJson && <pre className="mt-2 overflow-x-auto rounded bg-destructive/10 p-2 font-mono text-[11px] text-destructive">{errorJson}</pre>}
                    {dataJson && <pre className="mt-2 max-h-44 overflow-auto rounded bg-muted p-2 font-mono text-[11px] text-muted-foreground">{dataJson}</pre>}
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="py-2 text-muted-foreground text-center">本次运行没有可展示的 span。</p>
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
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

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

  // Listen to global new agentic chat event from sidebar
  useEffect(() => {
    const handleGlobalNewChat = () => newSession()
    window.addEventListener('memoria:new-agentic-chat', handleGlobalNewChat)
    return () => window.removeEventListener('memoria:new-agentic-chat', handleGlobalNewChat)
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Auto resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`
    }
  }, [input])

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
    textareaRef.current?.focus()
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

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSend()
    }
  }

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  return (
    <div className="flex h-full w-full">
      {/* Session History Sidebar (ChatGPT style) */}
      <div className="w-64 border-r border-border bg-sidebar/50 flex flex-col shrink-0">
        <div className="p-3 border-b border-border/80 space-y-1.5">
          <div className="flex items-center gap-2 px-1">
            <Sparkles className="w-4 h-4 text-purple-500" />
            <span className="text-sm font-semibold">Agentic RAG</span>
          </div>
          <p className="text-[11px] text-muted-foreground px-1 leading-relaxed">
            多知识库协同决策与自主推理
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1 min-h-0">
          <div className="flex items-center justify-between px-2 py-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            <span>历史会话</span>
            <button 
              onClick={newSession}
              className="p-1 hover:bg-accent rounded text-muted-foreground hover:text-foreground transition-colors"
              title="新建会话"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {sessions.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-8">暂无历史记录</p>
          )}

          {sessions.map(session => (
            <div
              key={session.id}
              className={`group relative flex items-center rounded-xl text-sm transition-all px-3 py-2 cursor-pointer ${
                session.id === sessionId
                  ? 'bg-accent text-foreground font-medium'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
              }`}
              onClick={() => {
                if (editingSessionId !== session.id) loadSession(session.id)
              }}
            >
              {editingSessionId === session.id ? (
                <div className="w-full" onClick={event => event.stopPropagation()}>
                  <input
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
                    className="w-full h-7 rounded-md bg-background px-2 text-xs text-foreground border border-border focus:outline-hidden"
                  />
                </div>
              ) : (
                <>
                  <span className="truncate pr-12 text-xs">{sessionTitle(session)}</span>
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      className="p-1 rounded hover:bg-background/80 text-muted-foreground hover:text-foreground transition-colors"
                      onClick={event => { event.stopPropagation(); startRename(session) }}
                      disabled={renameSessionMutation.isPending || sendMutation.isPending}
                      title="重命名"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      className="p-1 rounded hover:bg-background/80 text-muted-foreground hover:text-destructive transition-colors"
                      onClick={event => { event.stopPropagation(); deleteSessionMutation.mutate(session.id) }}
                      disabled={deleteSessionMutation.isPending || sendMutation.isPending}
                      title="删除"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Main Agent Chat Flow (ChatGPT layout) */}
      <div className="flex-1 flex flex-col min-w-0 h-full bg-background relative">
        {/* Top Header */}
        <header className="h-12 border-b border-border/60 flex items-center justify-between px-6 shrink-0 bg-background/80 backdrop-blur-xs">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm">Agentic 智能推理</span>
            <Badge variant="outline" className="text-[11px] font-normal text-muted-foreground gap-1">
              <Sparkles className="w-3 h-3 text-purple-500" />
              Agentic Mode
            </Badge>
          </div>
          <button
            onClick={newSession}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2.5 py-1 rounded-lg hover:bg-accent transition-colors"
          >
            <MessageSquarePlus className="w-3.5 h-3.5" />
            <span>新对话</span>
          </button>
        </header>

        {/* Message Stream */}
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center min-h-[50vh] text-center space-y-4">
                <div className="w-12 h-12 rounded-2xl bg-purple-500/10 text-purple-500 flex items-center justify-center shadow-xs">
                  <BrainCircuit className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-xl font-semibold tracking-tight">Agentic RAG 自主推理模式</h2>
                  <p className="text-sm text-muted-foreground max-w-md">
                    智能体将根据问题自主调度多个知识库，执行多步推理并追踪每一步工具调用。
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3 max-w-lg w-full pt-4">
                  <button 
                    onClick={() => { setInput('综合对比各个知识库中的关键技术方案'); textareaRef.current?.focus() }}
                    className="p-3 text-left rounded-xl border border-border hover:bg-accent/50 text-xs transition-colors space-y-1"
                  >
                    <div className="font-medium text-foreground">跨库对比分析</div>
                    <div className="text-muted-foreground text-[11px]">自主多步检索与综合比较</div>
                  </button>
                  <button 
                    onClick={() => { setInput('排查该问题背后的所有可能原因'); textareaRef.current?.focus() }}
                    className="p-3 text-left rounded-xl border border-border hover:bg-accent/50 text-xs transition-colors space-y-1"
                  >
                    <div className="font-medium text-foreground">深度问题溯源</div>
                    <div className="text-muted-foreground text-[11px]">多工具协同调用与溯源</div>
                  </button>
                </div>
              </div>
            )}

            {messages.map((message, index) => (
              <div key={message.id || index} className="group">
                {message.role === 'user' ? (
                  <div className="flex justify-end">
                    <div className="max-w-[85%] rounded-3xl bg-[#f4f4f4] dark:bg-[#2f2f2f] px-5 py-3 text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                      {message.content}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-4">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 text-white flex items-center justify-center shrink-0 mt-0.5 shadow-xs">
                      <Sparkles className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="text-sm leading-relaxed text-foreground">
                        {message.content ? (
                          <ReactMarkdown components={mdComponents}>{message.content}</ReactMarkdown>
                        ) : sendMutation.isPending && index === messages.length - 1 ? (
                          <div className="flex items-center gap-2 text-muted-foreground text-sm">
                            <span className="inline-block w-2 h-2 rounded-full bg-purple-500 animate-ping" />
                            <span>正在调度知识库并进行深度推理…</span>
                          </div>
                        ) : null}
                      </div>

                      <UsedKnowledgeBases ids={message.usedKbs || []} getKnowledgeBaseName={getKnowledgeBaseName} />
                      {message.sources && <SourceList sources={message.sources} getKnowledgeBaseName={getKnowledgeBaseName} />}
                      {message.trace && <TracePanel trace={message.trace} />}

                      {/* Action buttons (Copy) */}
                      {message.content && !sendMutation.isPending && (
                        <div className="flex items-center gap-2 pt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => copyToClipboard(message.content, message.id)}
                            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary text-xs flex items-center gap-1 transition-colors"
                            title="复制内容"
                          >
                            {copiedId === message.id ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                            <span className="text-[11px]">{copiedId === message.id ? '已复制' : '复制'}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        </div>

        {/* Floating Input Area (ChatGPT Style) */}
        <div className="shrink-0 pb-6 pt-2 bg-gradient-to-t from-background via-background to-transparent">
          <div className="max-w-3xl mx-auto px-4">
            <div className="relative flex flex-col rounded-3xl border border-border bg-[#f4f4f4] dark:bg-[#2f2f2f] shadow-sm focus-within:border-foreground/40 transition-colors p-2.5">
              <textarea
                ref={textareaRef}
                rows={1}
                placeholder="给 Agentic RAG 发送消息…"
                value={input}
                onChange={event => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
                disabled={sendMutation.isPending}
                className="w-full bg-transparent resize-none border-0 text-sm text-foreground placeholder:text-muted-foreground focus:outline-hidden px-2.5 pt-1.5 pb-2 min-h-[28px] max-h-[200px]"
              />
              <div className="flex items-center justify-between pt-1 px-1">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Sparkles className="w-3.5 h-3.5 text-purple-500" />
                  <span className="text-[11px]">自主知识库检索 Agent</span>
                </div>
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || sendMutation.isPending}
                  className={`p-2 rounded-full transition-all ${
                    input.trim() && !sendMutation.isPending
                      ? 'bg-foreground text-background hover:opacity-90 shadow-xs'
                      : 'bg-muted-foreground/20 text-muted-foreground cursor-not-allowed'
                  }`}
                  title="发送消息"
                >
                  <ArrowUp className="w-4 h-4" />
                </button>
              </div>
            </div>
            <p className="text-center text-[11px] text-muted-foreground mt-2">
              Agent 会根据提问自动检索相关知识并执行多步骤验证。
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
