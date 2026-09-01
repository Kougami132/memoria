import { Button } from '@/components/ui/button'
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Badge } from '@/components/ui/badge'
import {
  Activity,
  Check,
  Copy,
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
  RotateCcw,
  Sparkles,
  Square,
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
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-xs text-left border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-muted/60 text-foreground font-semibold border-b border-border">
      {children}
    </thead>
  ),
  tbody: ({ children }) => (
    <tbody className="divide-y divide-border/60">{children}</tbody>
  ),
  tr: ({ children }) => (
    <tr className="hover:bg-muted/30 transition-colors">{children}</tr>
  ),
  th: ({ children }) => (
    <th className="px-3 py-2 text-xs font-semibold text-foreground border-r border-border/40 last:border-r-0">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-2 text-xs text-foreground/90 border-r border-border/40 last:border-r-0 whitespace-pre-wrap">
      {children}
    </td>
  ),
}

const TOOL_CN_MAP: Record<string, string> = {
  delegate_to_knowledge_agent: '委派知识库专家 (KnowledgeAgent)',
  delegate_to_host_agent: '委派主机运维专家 (HostAgent)',
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
  if (name === 'delegate_to_knowledge_agent') return <Database className="w-3.5 h-3.5 text-blue-500" />
  if (name === 'delegate_to_host_agent') return <Server className="w-3.5 h-3.5 text-indigo-500" />
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

interface HostApprovalPrompt {
  approval_id: string
  host_id: string
  host_name: string
  command: string
}

interface StreamingAssistantState {
  thought: string
  thoughtExpanded: boolean
  traces: AgentTraceSpan[]
  answer: string
  isStreaming: boolean
  pendingApproval?: HostApprovalPrompt | null
  error?: string
}

export function AgenticChat() {
  const navigate = useNavigate()
  const { sessionId } = useParams<{ sessionId: string }>()
  const activeSessionId = sessionId || null
  useEffect(() => {
    currentSessionIdRef.current = activeSessionId
  }, [activeSessionId])
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [streamState, setStreamState] = useState<StreamingAssistantState | null>(null)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editingContent, setEditingContent] = useState('')
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const currentSendingTextRef = useRef<string>('')
  const currentUserMsgIdRef = useRef<string | null>(null)
  const currentTempUserMsgIdRef = useRef<string | null>(null)
  const currentSessionIdRef = useRef<string | null>(null)
  const isStoppingRef = useRef(false)

  const { data: sessions = [], refetch: refetchSessions } = useQuery({
    queryKey: ['agent-sessions'],
    queryFn: api.listAgentSessions,
  })

  // Listen to global new chat event from sidebar
  useEffect(() => {
    const handleGlobalNewChat = () => {
      setMessages([])
      setInput('')
      setStreamState(null)
      navigate('/agentic-chat')
    }
    window.addEventListener('memoria:new-chat', handleGlobalNewChat)
    return () => window.removeEventListener('memoria:new-chat', handleGlobalNewChat)
  }, [navigate])

  // Load messages for current session & poll if background task is streaming
  useEffect(() => {
    if (!activeSessionId) {
      setMessages([])
      return
    }
    let isMounted = true
    let pollTimer: any = null

    const fetchAndCheckStatus = async () => {
      try {
        const msgs = await api.getAgentMessages(activeSessionId)
        if (!isMounted) return
        setMessages(msgs)

      const lastMsg = msgs[msgs.length - 1]
        if (lastMsg && lastMsg.role === 'assistant' && (lastMsg.status === 'streaming' || lastMsg.status === 'pending_approval' || (lastMsg.status === 'approved' && !lastMsg.content))) {
        pollTimer = setTimeout(fetchAndCheckStatus, 1500)
      }
      } catch (err) {
        console.error('Failed to fetch agent messages:', err)
      }
    }

    fetchAndCheckStatus()

    return () => {
      isMounted = false
      if (pollTimer) clearTimeout(pollTimer)
    }
  }, [activeSessionId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamState])

  // Prevent accidental navigation/refresh during streaming or pending approval
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (streamState?.isStreaming || streamState?.pendingApproval) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [streamState])

  const handleCreateSession = () => {
    setMessages([])
    setInput('')
    setStreamState(null)
    navigate('/agentic-chat')
  }

  const handleDeleteSession = async (id: string) => {
    try {
      await api.deleteAgentSession(id)
      await refetchSessions()
      if (activeSessionId === id) {
        const remaining = sessions.filter((s) => s.id !== id)
        const nextId = remaining.length > 0 ? remaining[0].id : null
        navigate(nextId ? `/agentic-chat/${encodeURIComponent(nextId)}` : '/agentic-chat', { replace: true })
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

  const executeAgentStream = async (text: string, targetSessionId?: string, userMsgId?: string) => {
    currentSendingTextRef.current = text
    if (userMsgId) currentTempUserMsgIdRef.current = userMsgId
    currentUserMsgIdRef.current = null
    const abortController = new AbortController()
    abortControllerRef.current = abortController

    setStreamState({
      thought: '',
      thoughtExpanded: true,
      traces: [],
      answer: '',
      isStreaming: true,
    })

    let currentSessionId = targetSessionId || activeSessionId || undefined
    currentSessionIdRef.current = currentSessionId || null
    try {
      for await (const event of api.streamAgentChat(text, currentSessionId, abortController.signal)) {
        if (event.type === 'init') {
          if (event.user_message_id) {
            currentUserMsgIdRef.current = event.user_message_id
          }
          if (event.session_id && event.session_id !== activeSessionId) {
            currentSessionId = event.session_id
            currentSessionIdRef.current = event.session_id
            navigate(`/agentic-chat/${encodeURIComponent(event.session_id)}`, { replace: true })
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
        } else if (event.type === 'approval_required') {
          setStreamState((prev) => prev ? {
            ...prev,
            pendingApproval: {
              approval_id: event.approval_id || "",
              host_id: event.host_id || "",
              host_name: event.host_name || event.host_id || "",
              command: event.command || "",
            },
          } : null)
        } else if (event.type === 'answer_delta') {
          setStreamState((prev) => prev ? {
            ...prev,
            answer: prev.answer + (event.delta || ''),
          } : null)
        } else if (event.type === 'done') {
          if (event.session_id && event.session_id !== activeSessionId) {
            navigate(`/agentic-chat/${encodeURIComponent(event.session_id)}`, { replace: true })
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
     if (err.name === 'AbortError') {
       setStreamState(null)
       return
     }
     setStreamState((prev) => prev ? {
       ...prev,
       isStreaming: false,
       error: err.message || '请求发生错误',
     } : null)
   } finally {
     abortControllerRef.current = null
     currentSendingTextRef.current = ''
     currentTempUserMsgIdRef.current = null
     currentUserMsgIdRef.current = null
   }
 }

  const handleStopStream = async (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault()
      e.stopPropagation()
    }
    isStoppingRef.current = true
    setTimeout(() => {
      isStoppingRef.current = false
    }, 800)

    let textToRestore = currentSendingTextRef.current
    const tempId = currentTempUserMsgIdRef.current
    const userMsgId = currentUserMsgIdRef.current

    if (!textToRestore) {
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user') {
          textToRestore = messages[i].content
          break
        }
      }
    }
    if (textToRestore) {
      setInput(textToRestore)
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    currentSendingTextRef.current = ''
    currentTempUserMsgIdRef.current = null
    currentUserMsgIdRef.current = null

    setMessages((prev) => {
      let cutoffIndex = -1
      if (userMsgId) {
        cutoffIndex = prev.findIndex((m) => m.id === userMsgId)
      }
      if (cutoffIndex < 0 && tempId) {
        cutoffIndex = prev.findIndex((m) => m.id === tempId)
      }
      if (cutoffIndex < 0) {
        for (let i = prev.length - 1; i >= 0; i--) {
          if (prev[i].role === 'user') {
            cutoffIndex = i
            break
          }
        }
      }
      if (cutoffIndex >= 0) {
        return prev.slice(0, cutoffIndex)
      }
      return prev.filter((m) => m.status !== 'streaming' && (!tempId || m.id !== tempId))
    })
    setStreamState(null)

    const sessId = currentSessionIdRef.current || activeSessionId
    if (sessId) {
      try {
        await api.abortAgentSession(sessId, { rollback: true, message_id: userMsgId || undefined })
      } catch (err) {
        console.error('Abort agent session error:', err)
      }
      try {
        const msgs = await api.getAgentMessages(sessId)
        setMessages(msgs)
      } catch (err) {
        console.error('Failed to reload messages after abort:', err)
      }
    }
  }

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (isStoppingRef.current) return
    const text = input.trim()
    if (!text || isResponding) return

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
    await executeAgentStream(text, activeSessionId || undefined, userMsg.id)
  }

  const handleCopy = (msgId: string, text: string) => {
    if (!text) return
    navigator.clipboard.writeText(text)
    setCopiedMessageId(msgId)
    setTimeout(() => setCopiedMessageId(null), 2000)
  }

  const handleEditAndResend = async (messageId: string, newContent: string) => {
    if (!activeSessionId || isResponding || !newContent.trim()) return
    setEditingMessageId(null)
    try {
      await api.truncateAgentSession(activeSessionId, { message_id: messageId, inclusive: true })
      const targetIdx = messages.findIndex((m) => m.id === messageId)
      const keptMessages = targetIdx >= 0 ? messages.slice(0, targetIdx) : messages
      const userMsg: Message = {
        id: 'temp-' + Date.now(),
        session_id: activeSessionId,
        role: 'user',
        content: newContent.trim(),
        created_at: new Date().toISOString(),
        sources: [],
      }
      setMessages([...keptMessages, userMsg])
      await executeAgentStream(newContent.trim(), activeSessionId, userMsg.id)
    } catch (err) {
      console.error('Failed to edit and resend in agent chat:', err)
    }
  }

  const handleResend = async (msg: Message) => {
    await handleEditAndResend(msg.id, msg.content)
  }

  const handleRegenerate = async (assistantMsgId: string) => {
    if (!activeSessionId || isResponding) return
    const targetIdx = messages.findIndex((m) => m.id === assistantMsgId)
    if (targetIdx < 0) return

    // Find preceding user message
    let lastUserMsg: Message | null = null
    for (let i = targetIdx - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        lastUserMsg = messages[i]
        break
      }
    }
    if (!lastUserMsg) return

    await api.truncateAgentSession(activeSessionId, { message_id: assistantMsgId, inclusive: true })
    setMessages(messages.slice(0, targetIdx))
    await executeAgentStream(lastUserMsg.content, activeSessionId, lastUserMsg.id)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (isStoppingRef.current) return
      if (!isResponding) {
        handleSend()
      }
    }
  }

  const handleRespondApproval = async (approved: boolean) => {
    if (!streamState?.pendingApproval) return
    const approvalId = streamState.pendingApproval.approval_id
    try {
      await api.respondHostApproval(approvalId, approved)
      setStreamState(prev => prev ? { ...prev, pendingApproval: null } : null)
    } catch (err) {
      console.error('Failed to respond to approval:', err)
    }
  }

 const handleRespondHistoricalApproval = async (approvalId: string, approved: boolean) => {
   try {
     await api.respondHostApproval(approvalId, approved)
     setMessages(prev => prev.map(m => {
       if (m.metadata?.approval_id === approvalId) {
         return { ...m, status: approved ? 'approved' : 'rejected' }
       }
       return m
     }))
      if (activeSessionId) {
        const checkAfterDecision = async () => {
          try {
            const msgs = await api.getAgentMessages(activeSessionId)
            setMessages(msgs)
            const lastMsg = msgs[msgs.length - 1]
            if (lastMsg && lastMsg.role === 'assistant' && (lastMsg.status === 'streaming' || lastMsg.status === 'pending_approval' || (lastMsg.status === 'approved' && !lastMsg.content))) {
              setTimeout(checkAfterDecision, 1500)
            }
          } catch (err) {
            console.error('Failed to poll agent status after approval decision:', err)
          }
        }
        setTimeout(checkAfterDecision, 800)
      }
   } catch (err) {
     console.error('Failed to respond to approval:', err)
   }
 }

 const isResponding = Boolean(
   streamState?.isStreaming ||
    messages.some((m) => m.status === 'streaming' || m.status === 'pending_approval' || (m.status === 'approved' && !m.content))
 )

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
                      navigate(`/agentic-chat/${encodeURIComponent(sess.id)}`)
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
              {(streamState ? messages.filter((m) => m.status !== 'streaming') : messages).map((msg) => (
                <ChatMessageItem
                  key={msg.id}
                  msg={msg}
                  isResponding={isResponding}
                  isEditing={editingMessageId === msg.id}
                  editingContent={editingContent}
                  onStartEdit={(targetMsg) => {
                    setEditingMessageId(targetMsg.id)
                    setEditingContent(targetMsg.content)
                  }}
                  onCancelEdit={() => {
                    setEditingMessageId(null)
                    setEditingContent('')
                  }}
                  onChangeEditContent={setEditingContent}
                  onSaveEdit={handleEditAndResend}
                  onResend={handleResend}
                  onRegenerate={handleRegenerate}
                  onCopy={handleCopy}
                  isCopied={copiedMessageId === msg.id}
                  onRespondApproval={handleRespondHistoricalApproval}
                />
              ))}

              {/* Streaming message */}
              {streamState && <StreamingMessageItem state={streamState} onRespondApproval={handleRespondApproval} />}
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
                placeholder={isResponding ? "助手正在响应中..." : "给 AI Agent 发送消息... (Enter 发送，Shift + Enter 换行)"}
                rows={3}
                disabled={isResponding}
                className="w-full resize-none bg-transparent px-3.5 py-2.5 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
              />
              <div className="flex items-center justify-end px-3 py-1.5 border-t border-border/50 bg-background/50 rounded-b-xl">
                {isResponding ? (
                  <button
                    key="agentic-stop-btn"
                    type="button"
                    onClick={handleStopStream}
                    className="inline-flex items-center justify-center p-1.5 rounded-lg bg-foreground text-background hover:opacity-90 transition-colors shadow-xs"
                    title="停止生成"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" />
                  </button>
                ) : (
                  <button
                    key="agentic-send-btn"
                    type="submit"
                    disabled={!input.trim()}
                    className="inline-flex items-center justify-center p-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    title="发送消息"
                  >
                    <ArrowUp className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

function ChatMessageItem({
  msg,
  isResponding,
  isEditing,
  editingContent,
  onStartEdit,
  onCancelEdit,
  onChangeEditContent,
  onSaveEdit,
  onResend,
  onRegenerate,
  onCopy,
  isCopied,
  onRespondApproval,
}: {
  msg: Message
  isResponding: boolean
  isEditing: boolean
  editingContent: string
  onStartEdit: (msg: Message) => void
  onCancelEdit: () => void
  onChangeEditContent: (val: string) => void
  onSaveEdit: (messageId: string, newContent: string) => void
  onResend: (msg: Message) => void
  onRegenerate: (assistantMsgId: string) => void
  onCopy: (msgId: string, text: string) => void
  isCopied: boolean
  onRespondApproval?: (approvalId: string, approved: boolean) => void
}) {
  const isUser = msg.role === 'user'
  const [traceExpanded, setTraceExpanded] = useState(false)
  const [thoughtExpanded, setThoughtExpanded] = useState(false)
  const [editInput, setEditInput] = useState(msg.content)
  const editInputRef = useRef<HTMLTextAreaElement>(null)

  // Parse trace & thought from metadata if available
  const trace = msg.trace
  const rawThought = trace?.metadata?.thought || trace?.metadata?.reasoning_content || trace?.summary?.reasoning
  const thought = typeof rawThought === 'string' ? rawThought : null
  const totalDurationMs = trace?.summary?.duration_ms ?? trace?.spans?.reduce((acc, s) => acc + (s.duration_ms || 0), 0)
  const totalDuration = formatDuration(totalDurationMs && totalDurationMs > 0 ? totalDurationMs : null)
  useEffect(() => {
    if (isEditing) {
      setEditInput(editingContent || msg.content)
      setTimeout(() => editInputRef.current?.focus(), 50)
    }
  }, [isEditing, editingContent, msg.content])

  return (
    <div className={`group flex gap-3 max-w-4xl mx-auto ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary flex-shrink-0 mt-0.5">
          <Bot className="w-4 h-4" />
        </div>
      )}

      <div className={`flex flex-col gap-1.5 max-w-[85%] ${isUser ? 'items-end' : 'items-start'}`}>
        {/* User Message */}
        {isUser ? (
          isEditing ? (
            <div className="w-full min-w-[320px] max-w-xl bg-card border border-border p-3 rounded-2xl shadow-sm space-y-2">
              <textarea
                ref={editInputRef}
                value={editInput}
                onChange={(e) => {
                  setEditInput(e.target.value)
                  onChangeEditContent(e.target.value)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    if (editInput.trim()) onSaveEdit(msg.id, editInput.trim())
                  }
                  if (e.key === 'Escape') onCancelEdit()
                }}
                rows={3}
                className="w-full bg-transparent resize-none border-0 text-sm text-foreground placeholder:text-muted-foreground focus:outline-hidden leading-relaxed"
              />
              <div className="flex items-center justify-end gap-2 pt-1 border-t border-border/50">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={onCancelEdit}
                  className="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  取消
                </Button>
                <Button
                  size="sm"
                  onClick={() => editInput.trim() && onSaveEdit(msg.id, editInput.trim())}
                  disabled={!editInput.trim()}
                  className="h-7 px-3 text-xs bg-primary text-primary-foreground hover:opacity-90"
                >
                  发送
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-end gap-1">
              <div className="bg-primary text-primary-foreground px-4 py-2.5 rounded-2xl rounded-tr-sm text-sm whitespace-pre-wrap">
                {msg.content}
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground pt-0.5">
                <button
                  onClick={() => onCopy(msg.id, msg.content)}
                  className="p-1 rounded-md hover:bg-muted hover:text-foreground transition-colors"
                  title={isCopied ? "已复制" : "复制"}
                >
                  {isCopied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
                <button
                  onClick={() => onStartEdit(msg)}
                  disabled={isResponding}
                  className="p-1 rounded-md hover:bg-muted hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  title="编辑"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => onResend(msg)}
                  disabled={isResponding}
                  className="p-1 rounded-md hover:bg-muted hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  title="重新发送"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )
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
            {trace && trace.spans && trace.spans.filter((s) => !(s.type === 'agent' && !s.parent_id && (s.name === 'Memoria AI Agent' || s.name === 'Orchestrator'))).length > 0 && (
              <div className="rounded-lg border border-border bg-muted/30 text-xs overflow-hidden">
                <button
                  onClick={() => setTraceExpanded(!traceExpanded)}
                  className="w-full flex items-center justify-between px-3 py-2 text-muted-foreground hover:bg-muted/50 font-medium transition-colors"
                >
                  <div className="flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-primary" />
                    <span>执行轨迹与工具调用 ({trace.spans.filter((s) => !(s.type === 'agent' && !s.parent_id && (s.name === 'Memoria AI Agent' || s.name === 'Orchestrator'))).length} 个步骤)</span>
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
                    {trace.spans.filter((s) => !(s.type === 'agent' && !s.parent_id && (s.name === 'Memoria AI Agent' || s.name === 'Orchestrator'))).map((span, idx) => (
                      <TraceSpanCard key={span.id || idx} span={span} />
                    ))}
                  </div>
                )}
              </div>
            )}

           {/* Answer Content */}
            {msg.status === 'pending_approval' && msg.metadata?.approval_id && (
               <div className="rounded-xl border border-blue-500/40 bg-blue-50/50 dark:bg-blue-950/30 p-4 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold text-blue-700 dark:text-blue-300">
                    <Terminal className="w-4 h-4 text-blue-500" />
                    <span>主机操作执行审批请求</span>
                  </div>
                  <Badge variant="outline" className="text-xs border-blue-400 text-blue-600 dark:text-blue-400">待审批</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  助手请求在主机 <strong className="text-foreground">{msg.metadata?.host_name || msg.metadata?.host_id}</strong> 上执行如下受控命令：
                </p>
                <div className="bg-background/80 dark:bg-muted/60 p-2.5 rounded-lg border border-border font-mono text-xs text-foreground select-all break-all">
                  {msg.metadata?.command}
                </div>
                <div className="flex items-center justify-end gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onRespondApproval?.(msg.metadata!.approval_id, false)}
                    className="rounded-lg h-8 px-3 text-xs border-destructive/40 text-destructive hover:bg-destructive/10"
                  >
                    拒绝执行
                  </Button>
                 <Button
                   size="sm"
                   onClick={() => onRespondApproval?.(msg.metadata!.approval_id, true)}
                   className="rounded-lg h-8 px-3 text-xs bg-blue-600 hover:bg-blue-700 text-white gap-1.5 shadow-sm"
                 >
                   <Check className="w-3.5 h-3.5" />
                   允许执行
                 </Button>
               </div>
             </div>
            )}

           {/* Answer Content or In-progress Prompt */}
            {(msg.status === 'streaming' || msg.status === 'approved') && !msg.content ? (
              <div className="bg-card border border-border px-4 py-3 rounded-2xl rounded-tl-sm text-sm shadow-sm text-muted-foreground flex items-center gap-2">
                <Sparkles className="w-4 h-4 animate-spin text-primary" />
                <span className="text-xs">助手正在思考与响应中，请稍候...</span>
              </div>
           ) : msg.content ? (
               <div className="bg-card border border-border px-4 py-3 rounded-2xl rounded-tl-sm text-sm shadow-sm text-foreground">
                 <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{msg.content}</ReactMarkdown>
               </div>
           ) : null}

           {msg.status === 'approved' && !msg.content && msg.metadata?.approval_id && (
              <div className="text-xs text-muted-foreground flex items-center gap-1.5 px-1">
                <Check className="w-3.5 h-3.5 text-green-500" />
                <span>已批准在主机 {msg.metadata?.host_name || msg.metadata?.host_id} 执行命令: <code className="font-mono">{msg.metadata?.command}</code></span>
              </div>
            )}

            {msg.status === 'rejected' && !msg.content && msg.metadata?.approval_id && (
              <div className="text-xs text-muted-foreground flex items-center gap-1.5 px-1">
                <AlertCircle className="w-3.5 h-3.5 text-destructive" />
                <span>已拒绝在主机 {msg.metadata?.host_name || msg.metadata?.host_id} 执行命令: <code className="font-mono">{msg.metadata?.command}</code></span>
              </div>
            )}

            {/* Sources & Citations */}
            {msg.sources && msg.sources.length > 0 && (
              <SourcesList sources={msg.sources} />
            )}

            {/* Assistant Action Bar */}
            {msg.status !== 'streaming' && (
              <div className="flex items-center gap-1 pt-1 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => onCopy(msg.id, msg.content)}
                  className="p-1 rounded-md hover:bg-muted hover:text-foreground transition-colors"
                  title={isCopied ? "已复制" : "复制"}
                >
                  {isCopied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
                <button
                  onClick={() => onRegenerate(msg.id)}
                  disabled={isResponding}
                  className="p-1 rounded-md hover:bg-muted hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  title="重新生成"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>
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

function StreamingMessageItem({
  state,
  onRespondApproval,
}: {
  state: StreamingAssistantState
  onRespondApproval?: (approved: boolean) => void
}) {
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
        {state.traces && state.traces.filter((s) => !(s.type === 'agent' && !s.parent_id && (s.name === 'Memoria AI Agent' || s.name === 'Orchestrator'))).length > 0 && (
          <div className="rounded-lg border border-border bg-muted/30 text-xs overflow-hidden">
            <button
              onClick={() => setTraceExpanded(!traceExpanded)}
              className="w-full flex items-center justify-between px-3 py-2 text-muted-foreground hover:bg-muted/50 font-medium transition-colors"
            >
              <div className="flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-primary" />
                <span>执行轨迹与工具调用 ({state.traces.filter((s) => !(s.type === 'agent' && !s.parent_id && (s.name === 'Memoria AI Agent' || s.name === 'Orchestrator'))).length} 个步骤)</span>
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
                {state.traces.filter((s) => !(s.type === 'agent' && !s.parent_id && (s.name === 'Memoria AI Agent' || s.name === 'Orchestrator'))).map((span, idx) => (
                  <TraceSpanCard key={span.id || idx} span={span} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Interactive Host Command Approval Card */}
        {state.pendingApproval && (
          <div className="rounded-xl border border-blue-500/40 bg-blue-50/50 dark:bg-blue-950/30 p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-blue-700 dark:text-blue-300">
                <Terminal className="w-4 h-4 text-blue-500" />
                <span>主机操作执行审批请求</span>
              </div>
              <span className="text-xs text-blue-600/80 dark:text-blue-400/80">等待您的许可</span>
            </div>
            <p className="text-xs text-muted-foreground">
              助手请求在主机 <strong className="text-foreground">{state.pendingApproval.host_name}</strong> 上执行如下受控命令：
            </p>
            <div className="bg-background/80 dark:bg-muted/60 p-2.5 rounded-lg border border-border font-mono text-xs text-foreground select-all break-all">
              {state.pendingApproval.command}
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() => onRespondApproval?.(false)}
                className="rounded-lg h-8 px-3 text-xs border-destructive/40 text-destructive hover:bg-destructive/10"
              >
                拒绝执行
              </Button>
              <Button
                size="sm"
                onClick={() => onRespondApproval?.(true)}
                className="rounded-lg h-8 px-3 text-xs bg-blue-600 hover:bg-blue-700 text-white gap-1.5 shadow-sm"
              >
                <Check className="w-3.5 h-3.5" />
                允许执行
              </Button>
            </div>
          </div>
        )}

      {/* Real-time Answer Output */}

       {state.answer && (
         <div className="bg-card border border-border px-4 py-3 rounded-2xl rounded-tl-sm text-sm shadow-sm text-foreground">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{state.answer}</ReactMarkdown>
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
  const agentName = span.agent_name || (span.agent_id === 'orchestrator' ? 'Orchestrator' : span.agent_id ? span.agent_id : 'Orchestrator')
  const isOrchestrator = span.agent_id === 'orchestrator' || (!span.agent_id && isGen)

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
          <Badge
            variant="secondary"
            className={`text-[10px] px-1.5 py-0 font-medium ${
              isOrchestrator
                ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20'
                : agentName.includes('Knowledge') || span.agent_id === 'knowledge_agent'
                ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20'
                : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
            }`}
          >
            {agentName}
          </Badge>
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
