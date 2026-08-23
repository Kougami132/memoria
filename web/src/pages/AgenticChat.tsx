import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
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
  Coins,
  Pencil,
  Plus,
  ArrowUp,
  Sparkles,
  Trash2,
  Wrench,
  BrainCircuit,
  Cpu,
  Database,
  Search,
  Server,
  Terminal,
  MessageSquarePlus,
} from 'lucide-react'
import * as api from '@/api'
import type { AgentTraceSpan, Message, Source } from '@/api'

const mdComponents: Components = {
  p: ({ children }) => <p className="mb-3 leading-7 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="list-disc pl-5 mb-3 space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 mb-3 space-y-1">{children}</ol>,
  li: ({ children }) => <li className="leading-7">{children}</li>,
  code: ({ className, children, node: _node, ...props }) => {
    const isInline = !className
    return isInline ? (
      <code className="bg-muted text-foreground px-1.5 py-0.5 rounded font-mono text-[13px]" {...props}>
        {children}
      </code>
    ) : (
      <code className="block text-sm" {...props}>
        {children}
      </code>
    )
  },
  pre: ({ children }) => (
    <pre className="my-3 overflow-x-auto rounded-lg bg-zinc-950 p-4 text-xs text-zinc-100 dark:bg-zinc-900 border border-border">
      {children}
    </pre>
  ),
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline hover:opacity-80">
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-primary/40 pl-4 italic text-muted-foreground my-3">
      {children}
    </blockquote>
  ),
}

const TOOL_CN_MAP: Record<string, string> = {
  list_knowledge_bases: '查询可用知识库',
  search_knowledge_base: '检索知识库内容',
  list_hosts: '查询可用远程主机',
  get_host_info: '获取主机运行状态',
  run_host_command: '远程执行受控命令',
}

function getToolDisplayName(name?: string, type?: string): string {
  if (type === 'generation') {
    return name ? `LLM 推理与决策 (${name})` : 'LLM 模型推理与决策'
  }
  if (!name) return '系统处理'
  return TOOL_CN_MAP[name] || name
}

function getToolIcon(name?: string, type?: string) {
  if (type === 'generation') return <Cpu className="w-3.5 h-3.5 text-purple-500" />
  if (name === 'list_knowledge_bases') return <Database className="w-3.5 h-3.5 text-blue-500" />
  if (name === 'search_knowledge_base') return <Search className="w-3.5 h-3.5 text-amber-500" />
  if (name === 'list_hosts') return <Server className="w-3.5 h-3.5 text-indigo-500" />
  if (name === 'get_host_info') return <Activity className="w-3.5 h-3.5 text-emerald-500" />
  if (name === 'run_host_command') return <Terminal className="w-3.5 h-3.5 text-sky-500" />
  return <Wrench className="w-3.5 h-3.5 text-muted-foreground" />
}

function formatDuration(ms?: number | null): string | null {
  if (ms === undefined || ms === null || isNaN(ms)) return null
  const s = ms / 1000
  return s < 0.1 ? `${s.toFixed(2)}s` : `${s.toFixed(1)}s`
}

interface StreamingAssistantState {
  thought: string
  thoughtExpanded: boolean
  traces: AgentTraceSpan[]
  answer: string
  isStreaming: boolean
  error?: string
}

export function AgenticChat() {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [streamState, setStreamState] = useState<StreamingAssistantState | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  const { data: sessions = [], refetch: refetchSessions } = useQuery({
    queryKey: ['agent-sessions'],
    queryFn: api.listAgentSessions,
  })

  // Listen to global new chat event from sidebar
  useEffect(() => {
    const handleGlobalNewChat = () => handleCreateSession()
    window.addEventListener('memoria:new-chat', handleGlobalNewChat)
    return () => window.removeEventListener('memoria:new-chat', handleGlobalNewChat)
  }, [])

  // Load messages for current session
  useEffect(() => {
    if (!activeSessionId) {
      setMessages([])
      return
    }
    api.getAgentMessages(activeSessionId)
      .then((msgs) => {
        setMessages(msgs)
      })
      .catch((err) => {
        console.error('Failed to fetch agent messages:', err)
      })
  }, [activeSessionId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamState])

  const handleCreateSession = async () => {
    setActiveSessionId(null)
    setMessages([])
  }

  const handleDeleteSession = async (id: string) => {
    try {
      await api.deleteAgentSession(id)
      await refetchSessions()
      if (activeSessionId === id) {
        const remaining = sessions.filter((s) => s.id !== id)
        setActiveSessionId(remaining.length > 0 ? remaining[0].id : null)
      }
    } catch (e) {
      console.error(e)
    }
  }

  const handleRenameSession = async (id: string) => {
    if (!editingTitle.trim()) {
      setEditingSessionId(null)
      return
    }
    try {
      await api.updateAgentSession(id, { title: editingTitle.trim() })
      await refetchSessions()
      setEditingSessionId(null)
      setEditingTitle('')
    } catch (e) {
      console.error(e)
    }
  }

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    const text = input.trim()
    if (!text || streamState?.isStreaming) return

    const userMsg: Message = {
      id: 'temp-' + Date.now(),
      session_id: activeSessionId || '',
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
      sources: [],
    }

    setMessages((prev) => [...prev, userMsg])
    setInput('')

    const abortController = new AbortController()
    abortControllerRef.current = abortController

    setStreamState({
      thought: '',
      thoughtExpanded: true,
      traces: [],
      answer: '',
      isStreaming: true,
    })

    try {
      let currentSessionId = activeSessionId || undefined
      for await (const event of api.streamAgentChat(text, currentSessionId, abortController.signal)) {
        if (event.type === 'init') {
          if (event.session_id && event.session_id !== activeSessionId) {
            currentSessionId = event.session_id
            setActiveSessionId(event.session_id)
            refetchSessions()
          }
        } else if (event.type === 'thought_delta') {
          setStreamState((prev) => prev ? {
            ...prev,
            thought: prev.thought + (event.delta || ''),
          } : null)
        } else if (event.type === 'trace_span') {
          if (event.span) {
            const span = event.span
            setStreamState((prev) => {
              if (!prev) return null
              const existingIndex = prev.traces.findIndex((s) => s.id === span.id)
              const updatedTraces = [...prev.traces]
              if (existingIndex >= 0) {
                updatedTraces[existingIndex] = { ...updatedTraces[existingIndex], ...span }
              } else {
                updatedTraces.push(span)
              }
              return { ...prev, traces: updatedTraces }
            })
          }
        } else if (event.type === 'answer_delta') {
          setStreamState((prev) => prev ? {
            ...prev,
            answer: prev.answer + (event.delta || ''),
          } : null)
        } else if (event.type === 'done') {
          if (event.session_id && event.session_id !== activeSessionId) {
            setActiveSessionId(event.session_id)
            refetchSessions()
          }
          if (currentSessionId || event.session_id) {
            const finalId = event.session_id || currentSessionId!
            const updatedMsgs = await api.getAgentMessages(finalId)
            setMessages(updatedMsgs)
          }
          setStreamState(null)
          break
        } else if (event.type === 'error') {
          setStreamState((prev) => prev ? {
            ...prev,
            isStreaming: false,
            error: event.detail || '处理失败',
          } : null)
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setStreamState((prev) => prev ? {
          ...prev,
          isStreaming: false,
          error: err.message || '请求发生错误',
        } : null)
      }
    } finally {
      abortControllerRef.current = null
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex h-full bg-background">
      {/* Session Sidebar */}
      <div className="w-64 border-r border-border flex flex-col bg-muted/20">
        <div className="p-3 border-b border-border flex items-center justify-between">
          <span className="font-semibold text-sm flex items-center gap-2">
            <BrainCircuit className="w-4 h-4 text-primary" />
            AI Agent
          </span>
          <button
            onClick={handleCreateSession}
            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="新建会话"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {sessions.length === 0 ? (
            <div className="p-4 text-xs text-center text-muted-foreground">暂无会话，点击右上角新建</div>
          ) : (
            sessions.map((sess) => {
              const isActive = sess.id === activeSessionId
              return (
                <div
                  key={sess.id}
                  onClick={() => {
                    if (editingSessionId !== sess.id) {
                      setActiveSessionId(sess.id)
                    }
                  }}
                  className={`group relative flex items-center justify-between p-2 rounded-lg cursor-pointer text-xs transition-colors ${
                    isActive ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {editingSessionId === sess.id ? (
                    <input
                      type="text"
                      className="bg-background border border-border rounded px-1.5 py-0.5 text-xs w-full text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      value={editingTitle}
                      autoFocus
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onBlur={() => handleRenameSession(sess.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRenameSession(sess.id)
                        if (e.key === 'Escape') setEditingSessionId(null)
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <>
                      <span className="truncate pr-8">{sess.title || '新会话'}</span>
                      <div className="hidden group-hover:flex items-center gap-1 absolute right-2 bg-inherit pl-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setEditingSessionId(sess.id)
                            setEditingTitle(sess.title || '')
                          }}
                          className="p-1 hover:text-foreground"
                          title="重命名"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDeleteSession(sess.id)
                          }}
                          className="p-1 hover:text-destructive"
                          title="删除"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col h-full bg-background overflow-hidden">
        {/* Header */}
        <div className="h-12 border-b border-border px-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" />
            <span className="font-semibold text-sm">AI Agent</span>
          </div>
          <button
            onClick={handleCreateSession}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground px-2.5 py-1 rounded-lg hover:bg-accent transition-colors cursor-pointer"
          >
            <MessageSquarePlus className="w-3.5 h-3.5" />
            <span>新对话</span>
          </button>
        </div>

        {/* Message Container */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {messages.length === 0 && !streamState ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary mb-2">
                <BrainCircuit className="w-6 h-6" />
              </div>
              <h3 className="text-base font-medium">你好！我是 AI Agent 助手</h3>
              <p className="text-xs text-muted-foreground max-w-sm">
                我可以自主调用可用知识库工具检索资料、进行思维链推理并实时呈现思考与执行轨迹。
              </p>
            </div>
          ) : (
            <>
              {messages.map((msg) => (
                <ChatMessageItem key={msg.id} msg={msg} />
              ))}

              {/* Streaming message */}
              {streamState && <StreamingMessageItem state={streamState} />}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Bar */}
        <div className="p-4 border-t border-border bg-background">
          <form onSubmit={handleSend} className="max-w-3xl mx-auto flex flex-col gap-2">
            <div className="relative border border-border rounded-xl bg-muted/20 focus-within:ring-1 focus-within:ring-primary focus-within:border-primary transition-all">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="给 AI Agent 发送消息... (Enter 发送，Shift + Enter 换行)"
                rows={3}
                disabled={streamState?.isStreaming}
                className="w-full resize-none bg-transparent px-3.5 py-2.5 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
              />
              <div className="flex items-center justify-end px-3 py-1.5 border-t border-border/50 bg-background/50 rounded-b-xl">
                <button
                  type="submit"
                  disabled={!input.trim() || streamState?.isStreaming}
                  className="inline-flex items-center justify-center p-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <ArrowUp className="w-4 h-4" />
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

function ChatMessageItem({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user'
  const [traceExpanded, setTraceExpanded] = useState(false)
  const [thoughtExpanded, setThoughtExpanded] = useState(false)

  // Parse trace & thought from metadata if available
  const trace = msg.trace
  const rawThought = trace?.metadata?.thought || trace?.metadata?.reasoning_content || trace?.summary?.reasoning
  const thought = typeof rawThought === 'string' ? rawThought : null
  const totalDurationMs = trace?.summary?.duration_ms ?? trace?.spans?.reduce((acc, s) => acc + (s.duration_ms || 0), 0)
  const totalDuration = formatDuration(totalDurationMs && totalDurationMs > 0 ? totalDurationMs : null)

  return (
    <div className={`flex gap-3 max-w-4xl mx-auto ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary flex-shrink-0 mt-0.5">
          <Bot className="w-4 h-4" />
        </div>
      )}

      <div className={`flex flex-col gap-2 max-w-[85%] ${isUser ? 'items-end' : 'items-start'}`}>
        {/* User Message */}
        {isUser ? (
          <div className="bg-primary text-primary-foreground px-4 py-2.5 rounded-2xl rounded-tr-sm text-sm whitespace-pre-wrap">
            {msg.content}
          </div>
        ) : (
          <div className="w-full space-y-3">
            {/* Thought Chain (if exists) */}
            {thought && (
              <div className="rounded-lg border border-primary/20 bg-primary/5 text-xs overflow-hidden">
                <button
                  onClick={() => setThoughtExpanded(!thoughtExpanded)}
                  className="w-full flex items-center justify-between px-3 py-2 text-primary font-medium hover:bg-primary/10 transition-colors"
                >
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>模型思考过程 (CoT)</span>
                  </div>
                  {thoughtExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
                {thoughtExpanded && (
                  <div className="p-3 pt-1 text-muted-foreground border-t border-primary/10 whitespace-pre-wrap leading-relaxed">
                    {thought}
                  </div>
                )}
              </div>
            )}

            {/* Traces / Steps if available */}
            {trace && trace.spans && trace.spans.filter((s) => s.type !== 'agent').length > 0 && (
              <div className="rounded-lg border border-border bg-muted/30 text-xs overflow-hidden">
                <button
                  onClick={() => setTraceExpanded(!traceExpanded)}
                  className="w-full flex items-center justify-between px-3 py-2 text-muted-foreground hover:bg-muted/50 font-medium transition-colors"
                >
                  <div className="flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-primary" />
                    <span>执行轨迹与工具调用 ({trace.spans.filter((s) => s.type !== 'agent').length} 个步骤)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {trace?.summary?.total_tokens !== undefined && trace.summary.total_tokens !== null && (
                      <span className="text-[11px] font-normal text-muted-foreground flex items-center gap-1 bg-muted/60 px-1.5 py-0.5 rounded" title={`Prompt: ${trace.summary.prompt_tokens ?? '-'}, Completion: ${trace.summary.completion_tokens ?? '-'}`}>
                        <Coins className="w-3 h-3 text-amber-500" />
                        <span>{trace.summary.total_tokens.toLocaleString()} tokens</span>
                      </span>
                    )}
                    {totalDuration && (
                      <span className="text-[11px] font-normal text-muted-foreground flex items-center gap-0.5">
                        <Clock3 className="w-3 h-3" />
                        {totalDuration}
                      </span>
                    )}
                    {traceExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </div>
                </button>
                {traceExpanded && (
                  <div className="p-3 border-t border-border space-y-2">
                    {trace.spans.filter((s) => s.type !== 'agent').map((span, idx) => (
                      <TraceSpanCard key={span.id || idx} span={span} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Answer Content */}
            <div className="bg-card border border-border px-4 py-3 rounded-2xl rounded-tl-sm text-sm shadow-sm text-foreground">
              <ReactMarkdown components={mdComponents}>{msg.content}</ReactMarkdown>
            </div>

            {/* Sources & Citations */}
            {msg.sources && msg.sources.length > 0 && (
              <SourcesList sources={msg.sources} />
            )}
          </div>
        )}
      </div>

      {isUser && (
        <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center text-muted-foreground flex-shrink-0 mt-0.5 font-semibold text-xs">
          我
        </div>
      )}
    </div>
  )
}

function StreamingMessageItem({ state }: { state: StreamingAssistantState }) {
  const [thoughtExpanded, setThoughtExpanded] = useState(true)
  const [traceExpanded, setTraceExpanded] = useState(true)
  const streamDurationMs = state.traces?.reduce((acc, s) => acc + (s.duration_ms || 0), 0)
  const totalDuration = formatDuration(streamDurationMs && streamDurationMs > 0 ? streamDurationMs : null)
  const streamTotalTokens = state.traces?.reduce((acc, s) => {
    const u = s.usage || (s.data as any)?.usage
    return acc + (u?.total_tokens || 0)
  }, 0)

  return (
    <div className="flex gap-3 max-w-4xl mx-auto justify-start">
      <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary flex-shrink-0 mt-0.5 animate-pulse">
        <Bot className="w-4 h-4" />
      </div>

      <div className="flex flex-col gap-2.5 max-w-[85%] w-full">
        {/* Real-time Thought Chain */}
        {state.thought && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 text-xs overflow-hidden">
            <button
              onClick={() => setThoughtExpanded(!thoughtExpanded)}
              className="w-full flex items-center justify-between px-3 py-2 text-primary font-medium hover:bg-primary/10 transition-colors"
            >
              <div className="flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 animate-spin text-primary" />
                <span>模型思考过程 (CoT)</span>
              </div>
              {thoughtExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
            {thoughtExpanded && (
              <div className="p-3 pt-1 text-muted-foreground border-t border-primary/10 whitespace-pre-wrap leading-relaxed">
                {state.thought}
              </div>
            )}
          </div>
        )}

        {/* Real-time Tool Execution Traces */}
        {state.traces && state.traces.filter((s) => s.type !== 'agent').length > 0 && (
          <div className="rounded-lg border border-border bg-muted/30 text-xs overflow-hidden">
            <button
              onClick={() => setTraceExpanded(!traceExpanded)}
              className="w-full flex items-center justify-between px-3 py-2 text-muted-foreground hover:bg-muted/50 font-medium transition-colors"
            >
              <div className="flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-primary" />
                <span>执行轨迹与工具调用 ({state.traces.filter((s) => s.type !== 'agent').length} 个步骤)</span>
              </div>
              <div className="flex items-center gap-2">
                {streamTotalTokens > 0 && (
                  <span className="text-[11px] font-normal text-muted-foreground flex items-center gap-1 bg-muted/60 px-1.5 py-0.5 rounded">
                    <Coins className="w-3 h-3 text-amber-500" />
                    <span>{streamTotalTokens.toLocaleString()} tokens</span>
                  </span>
                )}
                {totalDuration && (
                  <span className="text-[11px] font-normal text-muted-foreground flex items-center gap-0.5">
                    <Clock3 className="w-3 h-3" />
                    {totalDuration}
                  </span>
                )}
                {traceExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </div>
            </button>
            {traceExpanded && (
              <div className="p-3 border-t border-border space-y-2">
                {state.traces.filter((s) => s.type !== 'agent').map((span, idx) => (
                  <TraceSpanCard key={span.id || idx} span={span} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Real-time Answer Output */}
        {state.answer && (
          <div className="bg-card border border-border px-4 py-3 rounded-2xl rounded-tl-sm text-sm shadow-sm text-foreground">
            <ReactMarkdown components={mdComponents}>{state.answer}</ReactMarkdown>
          </div>
        )}

        {/* Error message */}
        {state.error && (
          <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/20 px-3 py-2 rounded-lg">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{state.error}</span>
          </div>
        )}
      </div>
    </div>
  )
}

function TraceSpanCard({ span }: { span: AgentTraceSpan }) {
  const [expanded, setExpanded] = useState(false)
  const toolName = span.name
  const isGen = span.type === 'generation'
  const displayName = getToolDisplayName(toolName, span.type)
  const isRunning = !span.ended_at && !span.error
  const isError = Boolean(span.error)

  const rawData = span.data || {}
  const rawInput = (rawData as Record<string, unknown>).input ?? (rawData as Record<string, unknown>).args
  const rawOutput = (rawData as Record<string, unknown>).output ?? (rawData as Record<string, unknown>).result ?? (rawData as Record<string, unknown>).content

  const usage = span.usage || (rawData as any)?.usage
  const formattedInput = rawInput !== undefined ? (typeof rawInput === 'object' ? JSON.stringify(rawInput, null, 2) : String(rawInput)) : ''
  const formattedOutput = rawOutput !== undefined ? (typeof rawOutput === 'object' ? JSON.stringify(rawOutput, null, 2) : String(rawOutput)) : ''
  const formattedError = span.error ? (typeof span.error === 'object' ? JSON.stringify(span.error, null, 2) : String(span.error)) : ''

  return (
    <div className="border border-border/70 rounded-md bg-background/50 overflow-hidden text-xs">
      <div
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between px-2.5 py-1.5 cursor-pointer hover:bg-muted/40 transition-colors"
      >
        <div className="flex items-center gap-2 overflow-hidden">
          {getToolIcon(toolName, span.type)}
          <span className="font-medium text-foreground">{displayName}</span>
          {!isGen && toolName && toolName !== displayName && (
            <span className="text-[11px] text-muted-foreground font-mono">({toolName})</span>
          )}
          {isRunning ? (
            <Badge variant="outline" className="text-[10px] px-1 py-0 border-blue-500/30 text-blue-500 animate-pulse">
              执行中
            </Badge>
          ) : isError ? (
            <Badge variant="outline" className="text-[10px] px-1 py-0 border-destructive/30 text-destructive">
              失败
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] px-1 py-0 border-emerald-500/30 text-emerald-600 dark:text-emerald-400">
              已完成
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {usage && usage.total_tokens !== undefined && usage.total_tokens !== null && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-1 bg-muted/70 px-1.5 py-0.5 rounded font-mono" title={`Prompt: ${usage.prompt_tokens ?? '-'}, Completion: ${usage.completion_tokens ?? '-'}`}>
              <Coins className="w-3 h-3 text-amber-500" />
              {usage.total_tokens.toLocaleString()} tokens
            </span>
          )}
          {span.duration_ms !== undefined && span.duration_ms !== null && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
              <Clock3 className="w-3 h-3" />
              {formatDuration(span.duration_ms)}
            </span>
          )}
          {expanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
        </div>
      </div>

      {expanded && (
        <div className="px-3 py-2 border-t border-border/50 bg-muted/20 space-y-2">
          {usage && (
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground bg-muted/40 p-2 rounded border border-border/40">
              <span className="font-medium text-foreground flex items-center gap-1">
                <Coins className="w-3.5 h-3.5 text-amber-500" />
                Token 消耗统计:
              </span>
              <span>输入 (Prompt): <strong className="font-mono text-foreground">{usage.prompt_tokens ?? '-'}</strong></span>
              <span>输出 (Completion): <strong className="font-mono text-foreground">{usage.completion_tokens ?? '-'}</strong></span>
              <span>总计 (Total): <strong className="font-mono text-foreground">{usage.total_tokens ?? '-'}</strong></span>
            </div>
          )}
          {formattedInput && (
            <div>
              <div className="text-[10px] font-semibold text-muted-foreground mb-1">
                {isGen ? '输入上下文 / 提示词 (Input):' : '输入参数 (Input):'}
              </div>
              <pre className="p-2 rounded bg-zinc-950 text-zinc-200 text-[11px] font-mono overflow-x-auto whitespace-pre-wrap max-h-48">
                {formattedInput}
              </pre>
            </div>
          )}
          {formattedOutput && (
            <div>
              <div className="text-[10px] font-semibold text-muted-foreground mb-1">
                {isGen ? '模型输出 / 决策 (Output):' : '执行结果 / 输出 (Output):'}
              </div>
              <pre className="p-2 rounded bg-zinc-950 text-zinc-200 text-[11px] font-mono overflow-x-auto whitespace-pre-wrap max-h-48">
                {formattedOutput}
              </pre>
            </div>
          )}
          {formattedError && (
            <div>
              <div className="text-[10px] font-semibold text-destructive mb-1">错误详情 (Error):</div>
              <div className="p-2 rounded bg-destructive/10 text-destructive text-[11px] font-mono whitespace-pre-wrap">
                {formattedError}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SourcesList({ sources }: { sources: Source[] }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded-lg border border-border/80 bg-muted/20 text-xs overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 text-muted-foreground hover:bg-muted/40 font-medium transition-colors"
      >
        <div className="flex items-center gap-1.5">
          <BookOpen className="w-3.5 h-3.5 text-primary" />
          <span>参考依据 ({sources.length} 个片段)</span>
        </div>
        {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>

      {expanded && (
        <div className="p-3 border-t border-border/60 space-y-2.5 max-h-60 overflow-y-auto">
          {sources.map((src, idx) => (
            <div key={idx} className="p-2 rounded border border-border/50 bg-background/60 space-y-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold text-foreground truncate max-w-[70%]">
                  [{idx + 1}] {src.filename || src.source || src.doc_id || '未知来源'}
                </span>
                {src.score !== undefined && (
                  <Badge variant="secondary" className="text-[10px] px-1 py-0">
                    相似度: {(src.score * 100).toFixed(1)}%
                  </Badge>
                )}
              </div>
              <div className="text-muted-foreground text-[11px] line-clamp-3 leading-relaxed whitespace-pre-wrap">
                {src.text}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default AgenticChat


