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
    try {
      const msgs = await api.getMessages(sid)
      setMessages(msgs.map(m => ({ role: m.role, content: m.content })))
    } catch {
      setMessages([])
    }
  }

  const newSession = () => {
    setSessionId(null)
    setMessages([])
    inputRef.current?.focus()
  }

  const sendMsg = useMutation({
    mutationFn: (message: string) => api.chat(botId, message, sessionId ?? undefined),
    onMutate: (message: string) => {
      setMessages(prev => [...prev, { role: 'user', content: message }])
      setInput('')
    },
    onSuccess: data => {
      if (!sessionId) { setSessionId(data.session_id); refetchSessions() }
      setMessages(prev => [...prev, { role: 'assistant', content: data.answer, sources: data.sources }])
    },
    onError: (_err, message) => {
      setMessages(prev => prev.slice(0, -1))
      setInput(message)
    },
  })

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && input.trim() && botId && !sendMsg.isPending) {
      e.preventDefault()
      sendMsg.mutate(input)
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
                        <div className="rounded-2xl rounded-tl-sm bg-card border px-4 py-3 text-sm leading-relaxed shadow-sm whitespace-pre-wrap">
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
                  <div className="bg-card border rounded-2xl rounded-tl-sm px-4 py-3.5 shadow-sm">
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
                  onClick={() => sendMsg.mutate(input)}
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
