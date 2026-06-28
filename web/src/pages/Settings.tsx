import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Eye, EyeOff, Save, Check } from 'lucide-react'
import * as api from '@/api'
import type { SettingsUpdate } from '@/api'

export default function Settings() {
  const qc = useQueryClient()
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.getSettings })
  const [form, setForm] = useState<Partial<Record<string, string>>>({})
  const [showKey, setShowKey] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => { if (settings) setForm({ ...settings }) }, [settings])

  const update = useMutation({
    mutationFn: () => {
      const payload: SettingsUpdate = {
        openai_base_url: form.openai_base_url,
        embedding_model: form.embedding_model,
        llm_model: form.llm_model,
        top_k: form.top_k ? Number(form.top_k) : undefined,
        chunk_size: form.chunk_size ? Number(form.chunk_size) : undefined,
        chunk_overlap: form.chunk_overlap ? Number(form.chunk_overlap) : undefined,
      }
      if (form.openai_api_key !== settings?.openai_api_key) {
        payload.api_key = form.openai_api_key
      }
      return api.updateSettings(payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    },
  })

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [key]: e.target.value }))

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">系统设置</h1>
        <p className="text-sm text-muted-foreground mt-1">配置 API 连接和 RAG 参数，保存后将自动重建 Pipeline</p>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base font-semibold text-foreground">API 配置</CardTitle>
          <CardDescription>OpenAI 兼容接口，支持 OpenAI、Azure、本地部署模型等</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">API 地址</Label>
            <Input
              placeholder="https://api.openai.com/v1"
              value={form.openai_base_url ?? ''}
              onChange={set('openai_base_url')}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">API 密钥</Label>
            <div className="flex gap-2">
              <Input
                type={showKey ? 'text' : 'password'}
                placeholder="sk-…"
                value={form.openai_api_key ?? ''}
                onChange={set('openai_api_key')}
                className="flex-1"
              />
              <Button
                variant="outline"
                size="icon"
                className="shrink-0"
                onClick={() => setShowKey(v => !v)}
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">嵌入模型</Label>
              <Input
                placeholder="text-embedding-3-small"
                value={form.embedding_model ?? ''}
                onChange={set('embedding_model')}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">对话模型</Label>
              <Input
                placeholder="gpt-4o-mini"
                value={form.llm_model ?? ''}
                onChange={set('llm_model')}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base font-semibold text-foreground">RAG 参数</CardTitle>
          <CardDescription>控制文档检索和分块的核心参数</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Top-K</Label>
              <Input
                type="number"
                placeholder="5"
                value={form.top_k ?? ''}
                onChange={set('top_k')}
              />
              <p className="text-xs text-muted-foreground">每次检索的块数量</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">块大小</Label>
              <Input
                type="number"
                placeholder="512"
                value={form.chunk_size ?? ''}
                onChange={set('chunk_size')}
              />
              <p className="text-xs text-muted-foreground">每块字符数上限</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">块重叠</Label>
              <Input
                type="number"
                placeholder="50"
                value={form.chunk_overlap ?? ''}
                onChange={set('chunk_overlap')}
              />
              <p className="text-xs text-muted-foreground">相邻块重叠字符数</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button
          variant="gradient"
          onClick={() => update.mutate()}
          disabled={update.isPending}
          className={`gap-2 ${saved ? 'from-green-500 to-emerald-400' : ''}`}
        >
          {saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
          {update.isPending ? '保存中…' : saved ? '已保存' : '保存设置'}
        </Button>
        {saved && (
          <p className="text-sm text-muted-foreground">设置已生效，Pipeline 已重建</p>
        )}
      </div>
    </div>
  )
}
