import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Bot, Plus, Trash2, Pencil, X, Check } from 'lucide-react'
import * as api from '@/api'
import type { Bot as BotType } from '@/api'

function BotForm({
  initial, kbs, hosts = [], onSubmit, onCancel, isPending, defaultPrompt,
}: {
  initial?: BotType
  kbs: api.KB[]
  hosts?: api.Host[]
  onSubmit: (data: api.BotCreate) => void
  onCancel?: () => void
  isPending: boolean
  defaultPrompt: string
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [prompt, setPrompt] = useState(initial?.system_prompt ?? defaultPrompt)
  const [selectedKBs, setSelectedKBs] = useState<Set<string>>(new Set(initial?.kb_ids ?? []))
  const [selectedHosts, setSelectedHosts] = useState<Set<string>>(new Set(initial?.host_ids ?? []))
  const [modelOverride, setModelOverride] = useState(initial?.model_override ?? '')

  const toggleKB = (id: string) => setSelectedKBs(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const toggleHost = (id: string) => setSelectedHosts(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">名称</Label>
        <Input 
          placeholder="例如：专业技术顾问 / 写作助手" 
          value={name} 
          onChange={e => setName(e.target.value)} 
          className="rounded-xl border-border bg-background"
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">系统提示词</Label>
        <Textarea
          placeholder="定义机器人的角色和行为指令…"
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          rows={4}
          className="rounded-xl border-border bg-background resize-none leading-relaxed"
        />
      </div>
      {kbs.length > 0 && (
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">关联知识库</Label>
          <div className="grid grid-cols-2 gap-2">
            {kbs.map(kb => (
              <label
                key={kb.id}
                className={`flex items-center gap-2.5 rounded-xl border p-2.5 cursor-pointer transition-colors ${
                  selectedKBs.has(kb.id)
                    ? 'border-foreground/30 bg-accent'
                    : 'border-border hover:bg-accent/40'
                }`}
              >
                <Checkbox
                  id={kb.id}
                  checked={selectedKBs.has(kb.id)}
                  onCheckedChange={() => toggleKB(kb.id)}
                />
                <span className="text-sm font-medium">{kb.name}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {hosts.length > 0 && (
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">关联 SSH 主机</Label>
          <div className="grid grid-cols-2 gap-2">
            {hosts.map(h => (
              <label
                key={h.id}
                className={`flex items-center gap-2.5 rounded-xl border p-2.5 cursor-pointer transition-colors ${
                  selectedHosts.has(h.id)
                    ? 'border-foreground/30 bg-accent'
                    : 'border-border hover:bg-accent/40'
                }`}
              >
                <Checkbox
                  id={h.id}
                  checked={selectedHosts.has(h.id)}
                  onCheckedChange={() => toggleHost(h.id)}
                />
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{h.name}</span>
                  <span className="text-[11px] text-muted-foreground font-mono">{h.username}@{h.host}</span>
                </div>
              </label>
            ))}
          </div>
        </div>
      )}
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          指定模型 <span className="normal-case font-normal text-muted-foreground">（可选，留空使用全局默认模型）</span>
        </Label>
        <Input
          placeholder="例如：gpt-4o, claude-3-5-sonnet"
          value={modelOverride}
          onChange={e => setModelOverride(e.target.value)}
          className="rounded-xl border-border bg-background"
        />
      </div>
      <div className="flex gap-2 pt-2">
        <Button
          onClick={() => onSubmit({
            name,
            system_prompt: prompt,
            kb_ids: [...selectedKBs],
            host_ids: [...selectedHosts],
            model_override: modelOverride || undefined,
          })}
          disabled={!name.trim() || isPending}
          className="rounded-xl bg-foreground text-background hover:opacity-90 gap-1.5"
        >
          <Check className="h-3.5 w-3.5" />
          {initial ? '保存配置' : '创建助手'}
        </Button>
        {onCancel && (
          <Button variant="outline" onClick={onCancel} className="rounded-xl border-border gap-1.5">
            <X className="h-3.5 w-3.5" />
            取消
          </Button>
        )}
      </div>
    </div>
  )
}

export default function Bots() {
  const qc = useQueryClient()
  const { data: bots = [] } = useQuery({ queryKey: ['bots'], queryFn: api.listBots })
  const { data: kbs = [] } = useQuery({ queryKey: ['kbs'], queryFn: api.listKBs })
  const { data: hosts = [] } = useQuery({ queryKey: ['hosts'], queryFn: api.listHosts })
  const { data: settings, isPending: settingsPending } = useQuery({ queryKey: ['settings'], queryFn: api.getSettings })
  const defaultPrompt = settings?.system_prompt ?? ''
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
    <div className="p-8 w-[860px] max-w-full mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">自定义助手 (Bots)</h1>
          <p className="text-sm text-muted-foreground mt-1">配置具有特定人设、提示词与专属知识库的定制 AI 助手</p>
        </div>
        <Button
          onClick={() => setShowCreate(v => !v)}
          disabled={settingsPending}
          className="rounded-xl bg-foreground text-background hover:opacity-90 gap-2 shrink-0 shadow-xs"
        >
          <Plus className="h-4 w-4" />
          新建助手
        </Button>
      </div>

      {showCreate && (
        <Card className="rounded-2xl border-border bg-card shadow-sm">
          <CardContent className="p-6">
            <h3 className="font-semibold text-base mb-4">创建新助手</h3>
            <BotForm
              kbs={kbs}
              hosts={hosts}
              onSubmit={data => createBot.mutate(data)}
              onCancel={() => setShowCreate(false)}
              isPending={createBot.isPending}
              defaultPrompt={defaultPrompt}
            />
          </CardContent>
        </Card>
      )}

      {bots.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center rounded-2xl border border-dashed border-border/80">
          <div className="w-12 h-12 rounded-2xl bg-secondary flex items-center justify-center text-muted-foreground mb-4">
            <Bot className="h-6 w-6" />
          </div>
          <p className="font-semibold text-base">暂无自定义助手</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">
            你可以创建专属助手并关联特定知识库，获得针对特定领域的精准问答。
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {bots.map(bot => (
            <div 
              key={bot.id} 
              className="group rounded-2xl border border-border bg-card hover:border-foreground/20 transition-all p-5 flex flex-col justify-between shadow-xs space-y-4"
            >
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center shrink-0">
                      <Bot className="h-5 w-5 text-foreground" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm text-foreground">{bot.name}</h3>
                      {bot.model_override && (
                        <span className="text-[11px] text-muted-foreground font-mono">{bot.model_override}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
                      onClick={() => setEditingId(editingId === bot.id ? null : bot.id)}
                    >
                      {editingId === bot.id ? <X className="h-4 w-4" /> : <Pencil className="h-3.5 w-3.5" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-lg text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        if (confirm(`确认删除机器人「${bot.name}」？`)) deleteBot.mutate(bot.id)
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {bot.system_prompt && (
                  <p className="text-xs text-muted-foreground line-clamp-2 mt-3 leading-relaxed">
                    {bot.system_prompt}
                  </p>
                )}
              </div>

              {((bot.kb_ids && bot.kb_ids.length > 0) || (bot.host_ids && bot.host_ids.length > 0)) && (
                <div className="flex flex-wrap gap-1.5 pt-2 border-t border-border/40">
                  {bot.kb_ids?.map(id => {
                    const kb = kbs.find(k => k.id === id)
                    return kb ? (
                      <Badge key={id} variant="secondary" className="text-[11px] font-normal px-2 py-0.5 rounded-md">
                        📚 {kb.name}
                      </Badge>
                    ) : null
                  })}
                  {bot.host_ids?.map(id => {
                    const h = hosts.find(hostItem => hostItem.id === id)
                    return h ? (
                      <Badge key={id} variant="outline" className="text-[11px] font-normal px-2 py-0.5 rounded-md bg-accent/40">
                        🖥️ {h.name}
                      </Badge>
                    ) : null
                  })}
                </div>
              )}

              {editingId === bot.id && (
                <div className="pt-4 border-t border-border">
                  <BotForm
                    initial={bot}
                    kbs={kbs}
                    hosts={hosts}
                    onSubmit={data => updateBot.mutate({ id: bot.id, data })}
                    onCancel={() => setEditingId(null)}
                    isPending={updateBot.isPending}
                    defaultPrompt={defaultPrompt}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
