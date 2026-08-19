import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { 
  ArrowUp, 
  Plus, 
  ChevronDown, 
  ChevronUp, 
  BookOpen, 
  Sparkle, 
  Trash2, 
  Pencil, 
  Copy, 
  Check, 
  Bot,
  MessageSquarePlus,
  Sparkles
} from 'lucide-react'
import * as api from '@/api'
import type { Source } from '@/api'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'

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
  streaming?: boolean
  status?: string
}

function SourceList({ sources }: { sources: Source[] }) {
  const [open, setOpen] = useState(false)
  if (!sources.length) return null
  return (
    <div className="mt-3">
      <button
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground bg-secondary/70 hover:bg-secondary px-2.5 py-1 rounded-lg border border-border/60 transition-colors"
        onClick={() => setOpen(v => !v)}
      >
        <BookOpen className="h-3.5 w-3.5" />
        <span>参考来源 ({sources.length})</span>
        {open ? <ChevronUp className="h-3 w-3 ml-0.5" /> : <ChevronDown className="h-3 w-3 ml-0.5" />}
      </button>
      {open && (
        <div className="mt-2.5 space-y-2 max-w-2xl">
          {sources.map((s, i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-3 text-xs space-y-1.5 shadow-xs">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-medium text-foreground truncate block">
                    {s.source === 'vault' && s.filename ? s.filename : s.doc_id}
                  </span>
                  {s.source === 'vault' && s.path && (
                    <span className="text-[11px] text-muted-foreground font-mono truncate block">{s.path}</span>
                  )}
                </div>
                <Badge variant="secondary" className="text-[11px] shrink-0 font-normal">
                  匹配度 {(s.score * 100).toFixed(0)}%
                </Badge>
              </div>
              <p className="text-muted-foreground line-clamp-3 leading-relaxed">{s.text}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

type SendMessageVars = { message: string; placeholderId: string }
type SendContext = { previousSessionId: string | null }

export default function Chat() {
  const { data: bots = [] } = useQuery({ queryKey: ['bots'], queryFn: api.listBots })
  const [botId, setBotId] = useState<string>('')
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [input, setInput] = useState('')
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const skipRenameSaveRef = useRef(false)

  // Auto-select first bot if none selected
  useEffect(() => {
    if (!botId && bots.length > 0) {
      setBotId(bots[0].id)
    }
  }, [bots, botId])

  const { data: sessions = [], refetch: refetchSessions } = useQuery({
    queryKey: ['sessions', botId],
    queryFn: () => api.listSessions(botId),
    enabled: !!botId,
  })

  // Listen to global new chat event from sidebar
  useEffect(() => {
    const handleGlobalNewChat = () => newSession()
    window.addEventListener('memoria:new-chat', handleGlobalNewChat)
    return () => window.removeEventListener('memoria:new-chat', handleGlobalNewChat)
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

  const loadSession = async (sid: string) => {
    setSessionId(sid)
    try {
      const msgs = await api.getMessages(sid)
      setMessages(msgs.map(m => ({
        id: m.id,
        role: m.role,
        content: m.content,
        sources: m.sources,
      })))
    } catch {
      setMessages([])
    }
  }

  const newSession = () => {
    setSessionId(null)
    setMessages([])
    setEditingSessionId(null)
    setEditingTitle('')
    textareaRef.current?.focus()
  }

  const sessionTitle = (session: api.Session) => session.title?.trim() || '新对话'

  const startRename = (session: api.Session) => {
    setEditingSessionId(session.id)
    setEditingTitle(sessionTitle(session))
  }

  const clearRename = () => {
    setEditingSessionId(null)
    setEditingTitle('')
  }

  const cancelRename = () => {
    skipRenameSaveRef.current = true
    clearRename()
    window.setTimeout(() => {
      skipRenameSaveRef.current = false
    }, 0)
  }

  const renameSessionMutation = useMutation({
    mutationFn: ({ sid, title }: { sid: string; title: string }) => api.updateSession(sid, { title }),
    onSuccess: () => refetchSessions(),
    onError: () => refetchSessions(),
  })

  const finishRename = () => {
    if (skipRenameSaveRef.current) {
      skipRenameSaveRef.current = false
      return
    }
    if (!editingSessionId) return
    const sid = editingSessionId
    const title = editingTitle.trim()
    const previous = sessions.find(s => s.id === sid)
    clearRename()
    if (!title || (previous && sessionTitle(previous) === title)) return
    renameSessionMutation.mutate({ sid, title })
  }

  const sendMsg = useMutation<api.ChatStreamFinalEvent, Error, SendMessageVars, SendContext>({
    mutationFn: async ({ message, placeholderId }) => {
      let final: api.ChatStreamFinalEvent | null = null
      await api.chatStream(botId, message, sessionId ?? undefined, event => {
        if (event.type === 'meta') {
          setSessionId(event.session_id)
          setMessages(prev => prev.map(m =>
            m.id === placeholderId ? { ...m, sources: event.sources, streaming: true } : m,
          ))
          return
        }
        if (event.type === 'status') {
          setMessages(prev => prev.map(m =>
            m.id === placeholderId ? { ...m, status: event.message, streaming: true } : m,
          ))
          return
        }
        if (event.type === 'delta') {
          setMessages(prev => prev.map(m =>
            m.id === placeholderId
              ? { ...m, content: m.content + event.delta, status: undefined, streaming: true }
              : m,
          ))
          return
        }
        if (event.type === 'final') {
          final = event
          setMessages(prev => prev.map(m =>
            m.id === placeholderId
              ? { ...m, content: event.answer, sources: event.sources, status: undefined, streaming: false }
              : m,
          ))
        }
      })
      if (!final) throw new Error('stream ended before final response')
      return final
    },
    onMutate: ({ message, placeholderId }) => {
      const previousSessionId = sessionId
      const userId = `user-${placeholderId}`
      setMessages(prev => [
        ...prev,
        { id: userId, role: 'user', content: message },
        { id: placeholderId, role: 'assistant', content: '', streaming: true },
      ])
      setInput('')
      return { previousSessionId }
    },
    onSuccess: (final, _vars, ctx) => {
      setSessionId(final.session_id)
      if (!ctx?.previousSessionId) refetchSessions()
    },
    onError: (_err, vars, ctx) => {
      setMessages(prev => prev.slice(0, -2))
      setInput(vars.message)
      setSessionId(ctx?.previousSessionId ?? null)
    },
  })

  const isSending = sendMsg.isPending

  const deleteSessionMutation = useMutation({
    mutationFn: (sid: string) => api.deleteSession(sid),
    onSuccess: (_data, sid) => {
      if (sid === sessionId) newSession()
      refetchSessions()
    },
    onError: () => refetchSessions(),
  })

  const handleSend = () => {
    const message = input.trim()
    if (!message || !botId || isSending) return
    sendMsg.mutate({ message, placeholderId: crypto.randomUUID() })
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const currentBot = bots.find(b => b.id === botId)

  return (
    <div className="flex h-full w-full">
      {/* Session History Sidebar (ChatGPT style) */}
      <div className="w-64 border-r border-border bg-sidebar/50 flex flex-col shrink-0">
        <div className="p-3 border-b border-border/80 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground tracking-wider uppercase">助手模型</span>
          </div>
          <Select
            value={botId}
            onValueChange={id => { setBotId(id); setSessionId(null); setMessages([]); clearRename() }}
            disabled={isSending}
          >
            <SelectTrigger className="bg-background text-sm h-9 rounded-xl border-border">
              <SelectValue placeholder="选择机器人" />
            </SelectTrigger>
            <SelectContent>
              {bots.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
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

          {botId && sessions.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-8">暂无历史记录</p>
          )}

          {sessions.map(s => (
            <div
              key={s.id}
              className={`group relative flex items-center rounded-xl text-sm transition-all px-3 py-2 cursor-pointer ${
                s.id === sessionId
                  ? 'bg-accent text-foreground font-medium'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
              }`}
              onClick={() => {
                if (editingSessionId !== s.id) loadSession(s.id)
              }}
            >
              {editingSessionId === s.id ? (
                <div className="w-full" onClick={e => e.stopPropagation()}>
                  <input
                    autoFocus
                    value={editingTitle}
                    onChange={e => setEditingTitle(e.target.value)}
                    onFocus={e => e.currentTarget.select()}
                    onBlur={finishRename}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        e.currentTarget.blur()
                      }
                      if (e.key === 'Escape') {
                        e.preventDefault()
                        cancelRename()
                      }
                    }}
                    disabled={renameSessionMutation.isPending}
                    className="w-full h-7 rounded-md bg-background px-2 text-xs text-foreground border border-border focus:outline-hidden"
                  />
                </div>
              ) : (
                <>
                  <span className="truncate pr-12 text-xs">{sessionTitle(s)}</span>
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      className="p-1 rounded hover:bg-background/80 text-muted-foreground hover:text-foreground transition-colors"
                      onClick={e => { e.stopPropagation(); startRename(s) }}
                      disabled={renameSessionMutation.isPending || isSending}
                      title="重命名"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      className="p-1 rounded hover:bg-background/80 text-muted-foreground hover:text-destructive transition-colors"
                      onClick={e => { e.stopPropagation(); deleteSessionMutation.mutate(s.id) }}
                      disabled={deleteSessionMutation.isPending || isSending}
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

      {/* Main Chat Flow (ChatGPT layout) */}
      <div className="flex-1 flex flex-col min-w-0 h-full bg-background relative">
        {/* Top Header */}
        <header className="h-12 border-b border-border/60 flex items-center justify-between px-6 shrink-0 bg-background/80 backdrop-blur-xs">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm">{currentBot?.name || '请选择助手'}</span>
            {currentBot && (
              <Badge variant="outline" className="text-[11px] font-normal text-muted-foreground">
                常规模式
              </Badge>
            )}
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
                <div className="w-12 h-12 rounded-2xl bg-secondary flex items-center justify-center text-foreground shadow-xs">
                  <Sparkles className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-xl font-semibold tracking-tight">有什么我可以帮你的？</h2>
                  <p className="text-sm text-muted-foreground">
                    基于 RAG 知识库与大语言模型，为你提供精准的检索与解答。
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3 max-w-lg w-full pt-4">
                  <button 
                    onClick={() => { setInput('总结一下知识库中的核心内容'); textareaRef.current?.focus() }}
                    className="p-3 text-left rounded-xl border border-border hover:bg-accent/50 text-xs transition-colors space-y-1"
                  >
                    <div className="font-medium text-foreground">总结知识库</div>
                    <div className="text-muted-foreground text-[11px]">提炼核心内容与重点</div>
                  </button>
                  <button 
                    onClick={() => { setInput('帮我搜索并解答关键概念'); textareaRef.current?.focus() }}
                    className="p-3 text-left rounded-xl border border-border hover:bg-accent/50 text-xs transition-colors space-y-1"
                  >
                    <div className="font-medium text-foreground">概念查询</div>
                    <div className="text-muted-foreground text-[11px]">检索相关知识切片与定义</div>
                  </button>
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={m.id || i} className="group">
                {m.role === 'user' ? (
                  <div className="flex justify-end">
                    <div className="max-w-[85%] rounded-3xl bg-[#f4f4f4] dark:bg-[#2f2f2f] px-5 py-3 text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                      {m.content}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-4">
                    <div className="w-7 h-7 rounded-full bg-foreground text-background flex items-center justify-center shrink-0 mt-0.5 shadow-xs">
                      <Sparkle className="w-4 h-4 fill-current" />
                    </div>
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="text-sm leading-relaxed text-foreground">
                        {m.content ? (
                          <ReactMarkdown components={mdComponents}>{m.content}</ReactMarkdown>
                        ) : m.streaming ? (
                          <div className="flex items-center gap-2 text-muted-foreground text-sm">
                            <span className="inline-block w-2 h-2 rounded-full bg-foreground animate-ping" />
                            <span>{m.status || '正在思考与检索…'}</span>
                          </div>
                        ) : null}
                        {m.streaming && m.content && (
                          <span className="ml-1 inline-block animate-pulse align-baseline text-muted-foreground">▋</span>
                        )}
                      </div>

                      {m.sources && <SourceList sources={m.sources} />}

                      {/* Action buttons (Copy) */}
                      {m.content && !m.streaming && (
                        <div className="flex items-center gap-2 pt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => copyToClipboard(m.content, m.id)}
                            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary text-xs flex items-center gap-1 transition-colors"
                            title="复制内容"
                          >
                            {copiedId === m.id ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                            <span className="text-[11px]">{copiedId === m.id ? '已复制' : '复制'}</span>
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
                placeholder={botId ? "给 Memoria 发送消息…" : "请先选择助手模型…"}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isSending || !botId}
                className="w-full bg-transparent resize-none border-0 text-sm text-foreground placeholder:text-muted-foreground focus:outline-hidden px-2.5 pt-1.5 pb-2 min-h-[28px] max-h-[200px]"
              />
              <div className="flex items-center justify-between pt-1 px-1">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Bot className="w-3.5 h-3.5" />
                  <span className="text-[11px]">{currentBot?.name || '未选择'}</span>
                </div>
                <button
                  onClick={handleSend}
                  disabled={!input.trim() || isSending || !botId}
                  className={`p-2 rounded-full transition-all ${
                    input.trim() && !isSending && botId
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
              Memoria 可能会生成不准确的信息，请以检索依据与事实为准。
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
