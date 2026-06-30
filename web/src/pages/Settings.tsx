import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Eye, EyeOff, Save, Check, FlaskConical } from 'lucide-react'
import * as api from '@/api'
import type { SettingsUpdate } from '@/api'

type TestState = { status: 'idle' } | { status: 'loading' } | { status: 'ok'; msg: string } | { status: 'err'; msg: string }

export default function Settings() {
  const qc = useQueryClient()
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.getSettings })
  const [form, setForm] = useState<Partial<Record<string, string>>>({})
  const [showKey, setShowKey] = useState(false)
  const [saved, setSaved] = useState(false)
  const [embedTest, setEmbedTest] = useState<TestState>({ status: 'idle' })
  const [chatTest, setChatTest] = useState<TestState>({ status: 'idle' })

  useEffect(() => { if (settings) setForm({ ...settings }) }, [settings])

  const update = useMutation({
    mutationFn: () => {
      const payload: SettingsUpdate = {
        openai_base_url: form.openai_base_url,
        embedding_model: form.embedding_model,
        llm_model: form.llm_model,
        top_k: form.top_k ? Number(form.top_k) : undefined,
        min_score: form.min_score ? Number(form.min_score) : undefined,
        chunk_size: form.chunk_size ? Number(form.chunk_size) : undefined,
        chunk_overlap: form.chunk_overlap ? Number(form.chunk_overlap) : undefined,
        vault_sync_interval_minutes: form.vault_sync_interval_minutes ? Number(form.vault_sync_interval_minutes) : undefined,
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
    onError: () => alert('保存失败，请重试'),
  })

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [key]: e.target.value }))

  const runTest = (fn: () => Promise<{ ok: boolean; dimensions?: number; elapsed_ms?: number }>,
                   set: (s: TestState) => void) => async () => {
    set({ status: 'loading' })
    try {
      const r = await fn()
      set({ status: 'ok', msg: r.dimensions != null ? `✓ ${r.dimensions}维` : `✓ ${r.elapsed_ms}ms` })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      set({ status: 'err', msg })
    }
  }

  const testBadge = (s: TestState) => {
    if (s.status === 'idle') return null
    if (s.status === 'loading') return <span className="text-xs text-muted-foreground">测试中…</span>
    if (s.status === 'ok') return <span className="text-xs text-green-600 dark:text-green-400 break-all">{s.msg}</span>
    return <span className="text-xs text-red-500 break-all">{s.msg}</span>
  }

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
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">嵌入模型</Label>
              <div className="flex gap-2 items-center">
                <Input
                  placeholder="text-embedding-3-small"
                  value={form.embedding_model ?? ''}
                  onChange={set('embedding_model')}
                  className="flex-1"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 gap-1.5"
                  disabled={embedTest.status === 'loading'}
                  onClick={runTest(api.testEmbedding, setEmbedTest)}
                >
                  <FlaskConical className="h-3.5 w-3.5" />
                  测试
                </Button>
              </div>
              {testBadge(embedTest)}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">对话模型</Label>
              <div className="flex gap-2 items-center">
                <Input
                  placeholder="gpt-4o-mini"
                  value={form.llm_model ?? ''}
                  onChange={set('llm_model')}
                  className="flex-1"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 gap-1.5"
                  disabled={chatTest.status === 'loading'}
                  onClick={runTest(api.testChat, setChatTest)}
                >
                  <FlaskConical className="h-3.5 w-3.5" />
                  测试
                </Button>
              </div>
              {testBadge(chatTest)}
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
          <div className="grid grid-cols-2 gap-4">
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
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">最低相关度</Label>
              <Input
                type="number"
                step="0.05"
                min="0"
                max="1"
                placeholder="0.5"
                value={form.min_score ?? ''}
                onChange={set('min_score')}
              />
              <p className="text-xs text-muted-foreground">低于此分数的块不注入提示词</p>
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

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base font-semibold text-foreground">Vault 同步</CardTitle>
          <CardDescription>配置 Vault 自动同步行为</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">自动同步间隔（分钟）</Label>
            <Input
              type="number"
              min="1"
              placeholder="15"
              value={form.vault_sync_interval_minutes ?? ''}
              onChange={set('vault_sync_interval_minutes')}
            />
            <p className="text-xs text-muted-foreground">Vault 自动同步的时间间隔，单位为分钟</p>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button
          variant={saved ? 'gradient-success' : 'gradient'}
          onClick={() => update.mutate()}
          disabled={update.isPending}
          className="gap-2"
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
