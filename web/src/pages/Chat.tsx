import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
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
    <div className="mt-1">
      <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setOpen(v => !v)}>
        Sources ({sources.length}) {open ? 'hide' : 'show'}
      </button>
      {open && (
        <div className="mt-1 space-y-1 rounded border p-2">
          {sources.map((s, i) => (
            <div key={i} className="text-xs">
              <span className="font-mono text-muted-foreground">{s.doc_id}</span>
              <Badge variant="outline" className="ml-2 text-xs">score: {s.score.toFixed(2)}</Badge>
              <p className="mt-0.5 text-muted-foreground line-clamp-2">{s.text}</p>
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

  const { data: sessions = [], refetch: refetchSessions } = useQuery({
    queryKey: ['sessions', botId],
    queryFn: () => api.listSessions(botId),
    enabled: !!botId,
  })

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const loadSession = async (sid: string) => {
    setSessionId(sid)
    const msgs = await api.getMessages(sid)
    setMessages(msgs.map(m => ({ role: m.role, content: m.content })))
  }

  const sendMsg = useMutation({
    mutationFn: () => api.chat(botId, input, sessionId ?? undefined),
    onMutate: () => { setMessages(prev => [...prev, { role: 'user', content: input }]); setInput('') },
    onSuccess: (data) => {
      if (!sessionId) { setSessionId(data.session_id); refetchSessions() }
      setMessages(prev => [...prev, { role: 'assistant', content: data.answer, sources: data.sources }])
    },
  })

  return (
    <div className="flex gap-4 h-[calc(100vh-8rem)]">
      <div className="w-48 flex flex-col gap-2">
        <Select value={botId} onValueChange={id => { setBotId(id); setSessionId(null); setMessages([]) }}>
          <SelectTrigger><SelectValue placeholder="Select Bot" /></SelectTrigger>
          <SelectContent>
            {bots.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {botId && (
          <>
            <Button variant="outline" size="sm" onClick={() => { setSessionId(null); setMessages([]) }}>
              + New Session
            </Button>
            <div className="flex-1 overflow-y-auto space-y-1">
              {sessions.map(s => (
                <button
                  key={s.id}
                  className={`w-full text-left rounded px-2 py-1 text-sm ${s.id === sessionId ? 'bg-accent' : 'hover:bg-muted'}`}
                  onClick={() => loadSession(s.id)}
                >
                  {s.created_at.slice(0, 16)}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      <div className="flex-1 flex flex-col">
        <div className="flex-1 overflow-y-auto space-y-3 rounded border p-4">
          {messages.map((m, i) => (
            <div key={i} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
              <div className={`max-w-[70%] rounded-lg px-3 py-2 text-sm ${m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                {m.content}
              </div>
              {m.role === 'assistant' && m.sources && <SourceList sources={m.sources} />}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
        <div className="mt-2 flex gap-2">
          <Input
            placeholder="Type a message..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && input.trim() && botId) sendMsg.mutate() }}
            disabled={!botId || sendMsg.isPending}
          />
          <Button onClick={() => sendMsg.mutate()} disabled={!botId || !input.trim() || sendMsg.isPending}>
            Send
          </Button>
        </div>
      </div>
    </div>
  )
}
