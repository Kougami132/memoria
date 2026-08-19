import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Eye, EyeOff, Save, Check, FlaskConical, Sliders, KeyRound, MessageSquareCode, RefreshCw } from 'lucide-react'
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
        system_prompt: form.system_prompt,
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

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [key]: e.target.value }))

  const runTest = (fn: () => Promise<{ ok: boolean; dimensions?: number; elapsed_ms?: number }>,
                   set: (s: TestState) => void) => async () => {
    set({ status: 'loading' })
    try {
      const r = await fn()
      set({ status: 'ok', msg: r.dimensions != null ? `✓ 连接正常 (${r.dimensions}维)` : `✓ 响应成功 (${r.elapsed_ms}ms)` })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      set({ status: 'err', msg: `✗ ${msg}` })
    }
  }

  const testBadge = (s: TestState) => {
    if (s.status === 'idle') return null
    if (s.status === 'loading') return <span className="text-xs text-muted-foreground">测试中…</span>
    if (s.status === 'ok') return <span className="text-xs text-emerald-600 dark:text-emerald-400 break-all">{s.msg}</span>
    return <span className="text-xs text-destructive break-all">{s.msg}</span>
  }

  return (
    <div className="p-8 w-[860px] max-w-full mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">全局设置</h1>
          <p className="text-sm text-muted-foreground mt-1">配置大模型服务商、嵌入模型及 RAG 核心管道参数</p>
        </div>
        <Button
          onClick={() => update.mutate()}
          disabled={update.isPending}
          className="rounded-xl bg-foreground text-background hover:opacity-90 gap-2 shadow-xs"
        >
          {saved ? <Check className="h-4 w-4 text-green-400" /> : <Save className="h-4 w-4" />}
          {update.isPending ? '保存中…' : saved ? '已保存设置' : '保存设置'}
        </Button>
      </div>

      <Card className="rounded-2xl border-border bg-card shadow-xs">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-foreground" />
            <CardTitle className="text-base font-semibold">API 与模型服务</CardTitle>
          </div>
          <CardDescription>兼容 OpenAI 规范的任何大模型与向量嵌入服务接口</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Base URL (API 地址)</Label>
            <Input
              placeholder="https://api.openai.com/v1"
              value={form.openai_base_url ?? ''}
              onChange={set('openai_base_url')}
              className="rounded-xl border-border bg-background"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">API Key (密钥)</Label>
            <div className="flex gap-2">
              <Input
                type={showKey ? 'text' : 'password'}
                placeholder="sk-…"
                value={form.openai_api_key ?? ''}
                onChange={set('openai_api_key')}
                className="flex-1 rounded-xl border-border bg-background font-mono text-sm"
              />
              <Button
                variant="outline"
                size="icon"
                className="shrink-0 rounded-xl border-border"
                onClick={() => setShowKey(v => !v)}
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">向量嵌入模型</Label>
              <div className="flex gap-2 items-center">
                <Input
                  placeholder="text-embedding-3-small"
                  value={form.embedding_model ?? ''}
                  onChange={set('embedding_model')}
                  className="flex-1 rounded-xl border-border bg-background font-mono text-xs"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 gap-1.5 rounded-xl border-border text-xs"
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
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">对话生成模型</Label>
              <div className="flex gap-2 items-center">
                <Input
                  placeholder="gpt-4o-mini"
                  value={form.llm_model ?? ''}
                  onChange={set('llm_model')}
                  className="flex-1 rounded-xl border-border bg-background font-mono text-xs"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 gap-1.5 rounded-xl border-border text-xs"
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

      <Card className="rounded-2xl border-border bg-card shadow-xs">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-foreground" />
            <CardTitle className="text-base font-semibold">RAG 检索参数</CardTitle>
          </div>
          <CardDescription>控制文档分块切割和向量相似度召回逻辑</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Top-K 数量</Label>
              <Input
                type="number"
                placeholder="5"
                value={form.top_k ?? ''}
                onChange={set('top_k')}
                className="rounded-xl border-border bg-background"
              />
              <p className="text-[11px] text-muted-foreground">每次召回块数</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">最低相似度</Label>
              <Input
                type="number"
                step="0.05"
                min="0"
                max="1"
                placeholder="0.5"
                value={form.min_score ?? ''}
                onChange={set('min_score')}
                className="rounded-xl border-border bg-background"
              />
              <p className="text-[11px] text-muted-foreground">过滤低相关度块</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">分块大小</Label>
              <Input
                type="number"
                placeholder="512"
                value={form.chunk_size ?? ''}
                onChange={set('chunk_size')}
                className="rounded-xl border-border bg-background"
              />
              <p className="text-[11px] text-muted-foreground">单块字符上限</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">重叠大小</Label>
              <Input
                type="number"
                placeholder="50"
                value={form.chunk_overlap ?? ''}
                onChange={set('chunk_overlap')}
                className="rounded-xl border-border bg-background"
              />
              <p className="text-[11px] text-muted-foreground">相邻块重叠字符</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border bg-card shadow-xs">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <MessageSquareCode className="w-4 h-4 text-foreground" />
            <CardTitle className="text-base font-semibold">系统通用提示词</CardTitle>
          </div>
          <CardDescription>用于未单独配置系统提示词的对话与兜底处理</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <Textarea
            placeholder="定义机器人全局默认人设与检索引用行为…"
            value={form.system_prompt ?? ''}
            onChange={set('system_prompt')}
            rows={5}
            className="rounded-xl border-border bg-background resize-none leading-relaxed"
          />
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-border bg-card shadow-xs">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-foreground" />
            <CardTitle className="text-base font-semibold">Vault 笔记库同步</CardTitle>
          </div>
          <CardDescription>Obsidian / 本地 Markdown 笔记的自动增量同步设置</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5 max-w-xs">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">同步间隔（分钟）</Label>
            <Input
              type="number"
              min="1"
              placeholder="15"
              value={form.vault_sync_interval_minutes ?? ''}
              onChange={set('vault_sync_interval_minutes')}
              className="rounded-xl border-border bg-background"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
