import { useState, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Eye, EyeOff, Save, Check, FlaskConical, KeyRound, MessageSquareCode, RefreshCw, Download, Database, Upload, AlertCircle } from 'lucide-react'
import * as api from '@/api'
import type { Settings, SettingsUpdate } from '@/api'

type TestState = { status: 'idle' } | { status: 'loading' } | { status: 'ok'; msg: string } | { status: 'err'; msg: string }
type FetchState = { status: 'idle' } | { status: 'loading' } | { status: 'ok'; msg: string } | { status: 'err'; msg: string }

interface GeneralSettingsTabProps {
  settings?: Settings
}

export default function GeneralSettingsTab({ settings }: GeneralSettingsTabProps) {
  const qc = useQueryClient()
  const [form, setForm] = useState<Partial<Record<string, string>>>({})
  const [showKey, setShowKey] = useState(false)
  const [showExternalToken, setShowExternalToken] = useState(false)
  const [saved, setSaved] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [fetchState, setFetchState] = useState<FetchState>({ status: 'idle' })
  const [embedTest, setEmbedTest] = useState<TestState>({ status: 'idle' })
  const [chatTest, setChatTest] = useState<TestState>({ status: 'idle' })
  const [backupRestoreState, setBackupRestoreState] = useState<{ status: 'idle' | 'loading' | 'success' | 'error'; msg: string }>({ status: 'idle', msg: '' })

  const initialBaselineRef = useRef<{ openai_api_key?: string; external_api_token?: string }>({})
  const hasInitializedRef = useRef(false)

  useEffect(() => {
    if (settings && !hasInitializedRef.current) {
      hasInitializedRef.current = true
      initialBaselineRef.current = {
        openai_api_key: settings.openai_api_key,
        external_api_token: settings.external_api_token,
      }
      setForm({
        openai_base_url: settings.openai_base_url ?? '',
        openai_api_key: settings.openai_api_key ?? '',
        external_api_token: settings.external_api_token ?? '',
        embedding_model: settings.embedding_model ?? '',
        llm_model: settings.llm_model ?? '',
        system_prompt: settings.system_prompt ?? '',
        vault_sync_interval_minutes: settings.vault_sync_interval_minutes ?? '15',
      })
      const initialModels = new Set<string>()
      if (settings.embedding_model) initialModels.add(settings.embedding_model)
      if (settings.llm_model) initialModels.add(settings.llm_model)
      if (initialModels.size > 0) {
        setAvailableModels(Array.from(initialModels))
      }
    }
  }, [settings])

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [key]: e.target.value }))

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const payload: SettingsUpdate = {
        openai_base_url: form.openai_base_url,
        embedding_model: form.embedding_model,
        llm_model: form.llm_model,
        system_prompt: form.system_prompt,
        vault_sync_interval_minutes: form.vault_sync_interval_minutes ? Number(form.vault_sync_interval_minutes) : undefined,
      }
      if (form.openai_api_key !== initialBaselineRef.current.openai_api_key) {
        payload.api_key = form.openai_api_key
      }
      if (form.external_api_token !== initialBaselineRef.current.external_api_token) {
        payload.external_api_token = form.external_api_token
      }

      await api.updateSettings(payload)
      initialBaselineRef.current = {
        openai_api_key: form.openai_api_key,
        external_api_token: form.external_api_token,
      }
      qc.invalidateQueries({ queryKey: ['settings'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      alert(`保存失败: ${msg}`)
    } finally {
      setIsSaving(false)
    }
  }

  const handleFetchModels = async () => {
    const baseUrl = form.openai_base_url || ''
    if (!baseUrl.trim()) {
      setFetchState({ status: 'err', msg: '请先填写 API Base URL' })
      return
    }
    setFetchState({ status: 'loading' })
    try {
      const res = await api.fetchModels({
        openai_base_url: form.openai_base_url,
        api_key: form.openai_api_key !== initialBaselineRef.current.openai_api_key ? form.openai_api_key : undefined,
      })
      const list = res.models || []
      const combined = Array.from(new Set([
        ...(form.embedding_model ? [form.embedding_model] : []),
        ...(form.llm_model ? [form.llm_model] : []),
        ...list,
      ]))
      setAvailableModels(combined)
      setFetchState({ status: 'ok', msg: `成功获取 ${list.length} 个模型` })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setFetchState({ status: 'err', msg: `获取模型失败: ${msg}` })
    }
  }

  const runTest = (fn: () => Promise<{ ok: boolean; dimensions?: number; elapsed_ms?: number }>,
                   setTest: (s: TestState) => void) => async () => {
    setTest({ status: 'loading' })
    try {
      const r = await fn()
      setTest({ status: 'ok', msg: r.dimensions != null ? `✓ 连接正常 (${r.dimensions}维)` : `✓ 响应成功 (${r.elapsed_ms}ms)` })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setTest({ status: 'err', msg: `✗ ${msg}` })
    }
  }

  const handleImportBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!confirm('恢复备份将覆盖当前系统的数据库、向量库(Chroma)及上传文件。确认继续导入？')) {
      e.target.value = ''
      return
    }
    setBackupRestoreState({ status: 'loading', msg: '正在导入恢复数据包…' })
    try {
      const res = await api.importBackup(file)
      setBackupRestoreState({
        status: 'success',
        msg: `恢复成功！恢复了 ${res.kbs_count} 个知识库，${res.vaults_count} 个笔记仓库。若新机网络或挂载路径变动，请至知识库管理页修改 Vault 配置。`
      })
      qc.invalidateQueries()
    } catch (err: any) {
      setBackupRestoreState({ status: 'error', msg: `导入失败: ${err.message || err}` })
    } finally {
      e.target.value = ''
    }
  }

  const testBadge = (s: TestState) => {
    if (s.status === 'idle') return null
    if (s.status === 'loading') return <span className="text-xs text-muted-foreground">测试中…</span>
    if (s.status === 'ok') return <span className="text-xs text-emerald-600 dark:text-emerald-400 break-all">{s.msg}</span>
    return <span className="text-xs text-destructive break-all">{s.msg}</span>
  }

  const fetchBadge = (s: FetchState) => {
    if (s.status === 'idle') return null
    if (s.status === 'loading') return <span className="text-xs text-muted-foreground">获取模型中…</span>
    if (s.status === 'ok') return <span className="text-xs text-emerald-600 dark:text-emerald-400 break-all">{s.msg}</span>
    return <span className="text-xs text-destructive break-all">{s.msg}</span>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">全局基础设置</h2>
          <p className="text-sm text-muted-foreground mt-0.5">配置大模型服务商、外部鉴权凭据、通用提示词及数据冷备份</p>
        </div>
        <Button
          onClick={handleSave}
          disabled={isSaving}
          className="rounded-xl bg-foreground text-background hover:opacity-90 gap-2 shadow-xs"
        >
          {saved ? <Check className="h-4 w-4 text-emerald-400" /> : <Save className="h-4 w-4" />}
          {isSaving ? '保存中…' : saved ? '已保存全局设置' : '保存全局设置'}
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
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">外部 API Token (Bearer)</Label>
            <div className="flex gap-2">
              <Input
                type={showExternalToken ? 'text' : 'password'}
                placeholder="留空则不启用认证"
                value={form.external_api_token ?? ''}
                onChange={set('external_api_token')}
                className="flex-1 rounded-xl border-border bg-background font-mono text-sm"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="shrink-0 rounded-xl border-border"
                onClick={() => setShowExternalToken(v => !v)}
                aria-label={showExternalToken ? '隐藏外部 API Token' : '显示外部 API Token'}
              >
                {showExternalToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-t border-border">
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={handleFetchModels}
                disabled={fetchState.status === 'loading'}
                className="gap-1.5 rounded-xl border-border text-xs"
              >
                <Download className="h-3.5 w-3.5" />
                {fetchState.status === 'loading' ? '获取模型中…' : '获取模型列表'}
              </Button>
              {fetchBadge(fetchState)}
            </div>
            {availableModels.length > 0 && (
              <span className="text-xs text-muted-foreground">
                已加载 {availableModels.length} 个可用模型
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">向量嵌入模型</Label>
              <div className="flex gap-2 items-center">
                <div className="flex-1">
                  <Select
                    value={form.embedding_model ?? ''}
                    onValueChange={val => setForm(f => ({ ...f, embedding_model: val }))}
                    disabled={availableModels.length === 0}
                  >
                    <SelectTrigger className="rounded-xl border-border bg-background font-mono text-xs h-9">
                      <SelectValue placeholder={availableModels.length === 0 ? "请先点击获取模型列表" : "从列表中选择嵌入模型"} />
                    </SelectTrigger>
                    <SelectContent>
                      {availableModels.map(m => (
                        <SelectItem key={m} value={m} className="font-mono text-xs">
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 gap-1.5 rounded-xl border-border text-xs h-9"
                  disabled={embedTest.status === 'loading' || !form.embedding_model}
                  onClick={runTest(
                    () =>
                      api.testEmbedding({
                        openai_base_url: form.openai_base_url,
                        api_key: form.openai_api_key !== initialBaselineRef.current.openai_api_key ? form.openai_api_key : undefined,
                        embedding_model: form.embedding_model,
                      }),
                    setEmbedTest
                  )}
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
                <div className="flex-1">
                  <Select
                    value={form.llm_model ?? ''}
                    onValueChange={val => setForm(f => ({ ...f, llm_model: val }))}
                    disabled={availableModels.length === 0}
                  >
                    <SelectTrigger className="rounded-xl border-border bg-background font-mono text-xs h-9">
                      <SelectValue placeholder={availableModels.length === 0 ? "请先点击获取模型列表" : "从列表中选择对话模型"} />
                    </SelectTrigger>
                    <SelectContent>
                      {availableModels.map(m => (
                        <SelectItem key={m} value={m} className="font-mono text-xs">
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 gap-1.5 rounded-xl border-border text-xs h-9"
                  disabled={chatTest.status === 'loading' || !form.llm_model}
                  onClick={runTest(
                    () =>
                      api.testChat({
                        openai_base_url: form.openai_base_url,
                        api_key: form.openai_api_key !== initialBaselineRef.current.openai_api_key ? form.openai_api_key : undefined,
                        llm_model: form.llm_model,
                      }),
                    setChatTest
                  )}
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

      <Card className="rounded-2xl border-border bg-card shadow-xs">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-foreground" />
            <CardTitle className="text-base font-semibold">系统数据迁移与冷备份</CardTitle>
          </div>
          <CardDescription>
            完整打包 SQLite 数据库、向量数据库(Chroma)和上传文档，用于跨机器无损迁移并保留 Embedding 结果
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2 rounded-xl h-8 text-xs cursor-pointer"
              onClick={() => {
                window.location.href = api.exportBackupUrl()
              }}
            >
              <Download className="w-3.5 h-3.5" />
              导出完整备份包 (.zip)
            </Button>

            <label className="cursor-pointer">
              <input
                type="file"
                accept=".zip"
                className="hidden"
                onChange={handleImportBackup}
                disabled={backupRestoreState.status === 'loading'}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2 rounded-xl h-8 text-xs pointer-events-none"
                disabled={backupRestoreState.status === 'loading'}
              >
                <Upload className="w-3.5 h-3.5" />
                {backupRestoreState.status === 'loading' ? '正在恢复导入…' : '导入并恢复备份 (.zip)'}
              </Button>
            </label>
          </div>

          {backupRestoreState.status !== 'idle' && (
            <div className={`p-3 rounded-xl text-xs border flex items-start gap-2 ${
              backupRestoreState.status === 'loading'
                ? 'bg-muted/50 border-border text-foreground'
                : backupRestoreState.status === 'success'
                ? 'bg-emerald-50/50 border-emerald-300 text-emerald-700 dark:bg-emerald-950/20 dark:border-emerald-800 dark:text-emerald-300'
                : 'bg-destructive/10 border-destructive/30 text-destructive'
            }`}>
              {backupRestoreState.status === 'success' ? (
                <Check className="w-4 h-4 shrink-0 mt-0.5" />
              ) : backupRestoreState.status === 'error' ? (
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              ) : (
                <RefreshCw className="w-4 h-4 shrink-0 mt-0.5 animate-spin" />
              )}
              <span>{backupRestoreState.msg}</span>
            </div>
          )}

          <p className="text-[11px] text-muted-foreground leading-relaxed">
            提示：迁移至新机器后，若另一台机器上由于网络代理、WebDAV 地址或本地文件夹路径变化，可在<b>「知识库」</b>列表中直接点击<b>「配置」</b>进行原位修改，系统将自动校验哈希并跳过已有文档，无需重新消耗 Token 计算向量。
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
