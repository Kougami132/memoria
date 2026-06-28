import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Send, Plus, ChevronDown, ChevronUp, MessageSquare, BookOpen } from 'lucide-react'
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
          {sessions.map(s => (
            <button
              key={s.id}
              className={`w-full text-left rounded-lg px-3 py-2.5 text-xs transition-colors ${
                s.id === sessionId
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-muted text-muted-foreground'
              }`}
              onClick={() => loadSession(s.id)}
            >
              <p className="font-medium">会话</p>
              <p className="opacity-60 mt-0.5">{s.created_at.slice(0, 16).replace('T', ' ')}</p>
            </button>
          ))}
        </div>
      </div>

      {/* 主聊天区 */}
      <div className="flex-1 flex flex-col min-w-0">
        {!botId ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <div className="rounded-2xl bg-muted/50 p-6 mb-4">
              <MessageSquare className="h-10 w-10 text-muted-foreground/40 mx-auto" />
            </div>
            <p className="font-medium text-muted-foreground">从左侧选择机器人开始对话</p>
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
                  <div className="max-w-[75%]">
                    <div
                      className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                        m.role === 'user'
                          ? 'bg-primary text-primary-foreground rounded-br-sm'
                          : 'bg-card border rounded-bl-sm shadow-sm'
                      }`}
                    >
                      {m.content}
                    </div>
                    {m.role === 'assistant' && m.sources && <SourceList sources={m.sources} />}
                  </div>
                </div>
              ))}
              {sendMsg.isPending && (
                <div className="flex justify-start">
                  <div className="bg-card border rounded-2xl rounded-bl-sm px-4 py-2.5 shadow-sm">
                    <span className="text-sm text-muted-foreground">正在思考…</span>
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
            <div className="border-t p-4 bg-background shrink-0">
              <div className="flex gap-2">
                <Input
                  ref={inputRef}
                  placeholder="输入消息，按 Enter 发送…"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={sendMsg.isPending}
                  className="rounded-xl"
                />
                <Button
                  onClick={() => sendMsg.mutate()}
                  disabled={!input.trim() || sendMsg.isPending}
                  className="rounded-xl px-4 shrink-0"
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
