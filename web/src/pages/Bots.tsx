import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Bot, Plus, Trash2, Pencil, X, Check } from 'lucide-react'
import * as api from '@/api'
import type { Bot as BotType } from '@/api'

function BotForm({
  initial, kbs, onSubmit, onCancel, isPending,
}: {
  initial?: BotType
  kbs: api.KB[]
  onSubmit: (data: api.BotCreate) => void
  onCancel?: () => void
  isPending: boolean
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [prompt, setPrompt] = useState(initial?.system_prompt ?? '')
  const [selectedKBs, setSelectedKBs] = useState<Set<string>>(new Set(initial?.kb_ids ?? []))
  const [modelOverride, setModelOverride] = useState(initial?.model_override ?? '')

  const toggleKB = (id: string) => setSelectedKBs(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">名称</Label>
        <Input placeholder="例如：客服助手" value={name} onChange={e => setName(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">系统提示词</Label>
        <Textarea
          placeholder="定义机器人的角色和行为，例如：你是一个专业的客服助手…"
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          rows={4}
          className="resize-none"
        />
      </div>
      {kbs.length > 0 && (
        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">关联知识库</Label>
          <div className="grid grid-cols-2 gap-2">
            {kbs.map(kb => (
              <label
                key={kb.id}
                className="flex items-center gap-2.5 rounded-lg border px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors"
              >
                <Checkbox
                  id={kb.id}
                  checked={selectedKBs.has(kb.id)}
                  onCheckedChange={() => toggleKB(kb.id)}
                />
                <span className="text-sm">{kb.name}</span>
              </label>
            ))}
          </div>
        </div>
      )}
      <div className="space-y-1.5">
        <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          指定模型 <span className="normal-case font-normal">（可选）</span>
        </Label>
        <Input
          placeholder="留空使用默认模型"
          value={modelOverride}
          onChange={e => setModelOverride(e.target.value)}
        />
      </div>
      <div className="flex gap-2 pt-1">
        <Button
          onClick={() => onSubmit({
            name,
            system_prompt: prompt,
            kb_ids: [...selectedKBs],
            model_override: modelOverride || undefined,
          })}
          disabled={!name.trim() || isPending}
          className="gap-1.5"
        >
          <Check className="h-3.5 w-3.5" />
          {initial ? '保存更改' : '创建机器人'}
        </Button>
        {onCancel && (
          <Button variant="outline" onClick={onCancel} className="gap-1.5">
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
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">机器人</h1>
          <p className="text-sm text-muted-foreground mt-1">配置 AI 助手，关联知识库，体验 RAG 检索对话</p>
        </div>
        <Button onClick={() => setShowCreate(v => !v)} className="gap-2 shrink-0">
          <Plus className="h-4 w-4" />
          新建机器人
        </Button>
      </div>

      {showCreate && (
        <Card className="border-primary/20 shadow-sm">
          <CardContent className="pt-5">
            <BotForm
              kbs={kbs}
              onSubmit={data => createBot.mutate(data)}
              onCancel={() => setShowCreate(false)}
              isPending={createBot.isPending}
            />
          </CardContent>
        </Card>
      )}

      {bots.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Bot className="h-12 w-12 text-muted-foreground/25 mb-4" />
          <p className="font-medium text-muted-foreground">暂无机器人</p>
          <p className="text-sm text-muted-foreground mt-1">点击右上角「新建机器人」开始</p>
        </div>
      ) : (
        <div className="space-y-3">
          {bots.map(bot => (
            <Card key={bot.id} className="overflow-hidden">
              <CardHeader className="py-3 px-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex items-center gap-2">
                      <Bot className="h-4 w-4 text-primary shrink-0" />
                      <span className="font-medium text-sm">{bot.name}</span>
                    </div>
                    {bot.kb_ids.length > 0 && (
                      <div className="flex flex-wrap gap-1 ml-6">
                        {bot.kb_ids.map(id => {
                          const kb = kbs.find(k => k.id === id)
                          return kb ? (
                            <Badge key={id} variant="secondary" className="text-xs font-normal py-0">
                              {kb.name}
                            </Badge>
                          ) : null
                        })}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      onClick={() => setEditingId(editingId === bot.id ? null : bot.id)}
                    >
                      {editingId === bot.id ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        if (confirm(`确认删除机器人「${bot.name}」？`)) deleteBot.mutate(bot.id)
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              {editingId === bot.id && (
                <CardContent className="border-t bg-muted/20 pt-4 pb-4">
                  <BotForm
                    initial={bot}
                    kbs={kbs}
                    onSubmit={data => updateBot.mutate({ id: bot.id, data })}
                    onCancel={() => setEditingId(null)}
                    isPending={updateBot.isPending}
                  />
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
