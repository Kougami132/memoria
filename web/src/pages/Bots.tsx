import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import * as api from '@/api'
import type { Bot } from '@/api'

function BotForm({
  initial, kbs, onSubmit, onCancel, isPending,
}: {
  initial?: Bot; kbs: api.KB[]
  onSubmit: (data: api.BotCreate) => void; onCancel?: () => void; isPending: boolean
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [prompt, setPrompt] = useState(initial?.system_prompt ?? '')
  const [selectedKBs, setSelectedKBs] = useState<Set<string>>(new Set(initial?.kb_ids ?? []))
  const [modelOverride, setModelOverride] = useState(initial?.model_override ?? '')

  const toggleKB = (id: string) => setSelectedKBs(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next
  })

  return (
    <div className="space-y-3">
      <Input placeholder="Bot name" value={name} onChange={e => setName(e.target.value)} />
      <Textarea placeholder="System Prompt" value={prompt} onChange={e => setPrompt(e.target.value)} rows={3} />
      <Input placeholder="model_override (optional)" value={modelOverride} onChange={e => setModelOverride(e.target.value)} />
      <div>
        <p className="text-sm font-medium mb-1">Associated Knowledge Bases</p>
        {kbs.map(kb => (
          <div key={kb.id} className="flex items-center gap-2">
            <Checkbox id={kb.id} checked={selectedKBs.has(kb.id)} onCheckedChange={() => toggleKB(kb.id)} />
            <Label htmlFor={kb.id}>{kb.name}</Label>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Button
          onClick={() => onSubmit({ name, system_prompt: prompt, kb_ids: [...selectedKBs], model_override: modelOverride || undefined })}
          disabled={!name.trim() || isPending}
        >{initial ? 'Save' : 'Create'}</Button>
        {onCancel && <Button variant="outline" onClick={onCancel}>Cancel</Button>}
      </div>
    </div>
  )
}

export default function Bots() {
  const qc = useQueryClient()
  const { data: bots = [] } = useQuery({ queryKey: ['bots'], queryFn: api.listBots })
  const { data: kbs = [] } = useQuery({ queryKey: ['kbs'], queryFn: api.listKBs })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  const createBot = useMutation({
    mutationFn: api.createBot,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bots'] }); setShowCreate(false) },
  })
  const updateBot = useMutation({
    mutationFn: ({ id, data }: { id: string; data: api.BotUpdate }) => api.updateBot(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bots'] }); setEditingId(null) },
  })
  const deleteBot = useMutation({
    mutationFn: api.deleteBot,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bots'] }),
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Bots</h1>
        <Button onClick={() => setShowCreate(v => !v)}>+ New Bot</Button>
      </div>
      {showCreate && (
        <Card>
          <CardHeader><CardTitle className="text-base">New Bot</CardTitle></CardHeader>
          <CardContent>
            <BotForm kbs={kbs} onSubmit={data => createBot.mutate(data)} onCancel={() => setShowCreate(false)} isPending={createBot.isPending} />
          </CardContent>
        </Card>
      )}
      {bots.map(bot => (
        <Card key={bot.id}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">{bot.name}</CardTitle>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditingId(editingId === bot.id ? null : bot.id)}>
                  {editingId === bot.id ? 'Cancel' : 'Edit'}
                </Button>
                <Button variant="ghost" size="sm"
                  onClick={() => { if (confirm(`Delete bot "${bot.name}"?`)) deleteBot.mutate(bot.id) }}>Delete</Button>
              </div>
            </div>
          </CardHeader>
          {editingId === bot.id && (
            <CardContent>
              <BotForm initial={bot} kbs={kbs}
                onSubmit={data => updateBot.mutate({ id: bot.id, data })}
                onCancel={() => setEditingId(null)} isPending={updateBot.isPending} />
            </CardContent>
          )}
        </Card>
      ))}
    </div>
  )
}
