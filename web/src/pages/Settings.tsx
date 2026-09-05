import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Eye, EyeOff, Save, Check, FlaskConical, Sliders, KeyRound, MessageSquareCode, RefreshCw, Download, ShieldAlert, Radio, Database, Upload, AlertCircle } from 'lucide-react'
import * as api from '@/api'
import type { QQSettingsUpdate, SettingsUpdate } from '@/api'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { TagInput } from '@/components/ui/tag-input'

type TestState = { status: 'idle' } | { status: 'loading' } | { status: 'ok'; msg: string } | { status: 'err'; msg: string }
type FetchState = { status: 'idle' } | { status: 'loading' } | { status: 'ok'; msg: string } | { status: 'err'; msg: string }

export default function Settings() {
  const qc = useQueryClient()
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: api.getSettings })
  const { data: qqSettings } = useQuery({ queryKey: ['qq-settings'], queryFn: api.getQQSettings })
  const { data: qqStatus } = useQuery({
    queryKey: ['qq-status'],
    queryFn: api.getQQStatus,
    refetchInterval: 3000,
  })
  const [form, setForm] = useState<Partial<Record<string, string>>>({})
  const [showKey, setShowKey] = useState(false)
  const [showExternalToken, setShowExternalToken] = useState(false)
  const [saved, setSaved] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [fetchState, setFetchState] = useState<FetchState>({ status: 'idle' })
  const [embedTest, setEmbedTest] = useState<TestState>({ status: 'idle' })
  const [backupRestoreState, setBackupRestoreState] = useState<{ status: 'idle' | 'loading' | 'success' | 'error'; msg: string }>({ status: 'idle', msg: '' })
  const [chatTest, setChatTest] = useState<TestState>({ status: 'idle' })
  const [qqForm, setQQForm] = useState<Partial<Record<string, string | boolean | string[]>>>({})

  useEffect(() => {
    if (settings) {
      setForm({ ...settings })
      const initialModels = new Set<string>()
      if (settings.embedding_model) initialModels.add(settings.embedding_model)
      if (settings.llm_model) initialModels.add(settings.llm_model)
      if (initialModels.size > 0) {
        setAvailableModels(Array.from(initialModels))
      }
    }
  }, [settings])

  useEffect(() => {
    if (qqSettings) {
      setQQForm({
        ...qqSettings,
        client_secret: '',
        enabled: qqSettings.enabled === 'true',
        c2c_enabled: qqSettings.c2c_enabled === 'true',
        group_enabled: qqSettings.group_enabled === 'true',
        group_require_mention: qqSettings.group_require_mention === 'true',
        allow_unlisted_users: qqSettings.allow_unlisted_users === 'true',
        allow_unlisted_groups: qqSettings.allow_unlisted_groups === 'true',
        group_approval_enabled: qqSettings.group_approval_enabled === 'true',
        user_allowlist: JSON.parse(qqSettings.user_allowlist || '[]'),
        group_allowlist: JSON.parse(qqSettings.group_allowlist || '[]'),
      })
    }
  }, [qqSettings])

  const handleSaveAll = async () => {
    setIsSaving(true)
    try {
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
      if (form.external_api_token !== settings?.external_api_token) {
        payload.external_api_token = form.external_api_token
      }


      const tasks: Promise<unknown>[] = [api.updateSettings(payload)]

      if (qqSettings) {
        const qqPayload: QQSettingsUpdate = {
          enabled: Boolean(qqForm.enabled),
          app_id: String(qqForm.app_id || ''),
          c2c_enabled: Boolean(qqForm.c2c_enabled),
          group_enabled: Boolean(qqForm.group_enabled),
          group_require_mention: Boolean(qqForm.group_require_mention),
          user_allowlist: Array.isArray(qqForm.user_allowlist) ? (qqForm.user_allowlist as string[]) : [],
          group_allowlist: Array.isArray(qqForm.group_allowlist) ? (qqForm.group_allowlist as string[]) : [],
          allow_unlisted_users: Boolean(qqForm.allow_unlisted_users),
          allow_unlisted_groups: Boolean(qqForm.allow_unlisted_groups),
          group_approval_enabled: Boolean(qqForm.group_approval_enabled),
          max_queue_size: Number(qqForm.max_queue_size || 32),
          run_timeout_seconds: Number(qqForm.run_timeout_seconds || 300),
        }
        if (qqForm.client_secret) {
          qqPayload.client_secret = String(qqForm.client_secret)
        }
        tasks.push(api.updateQQSettings(qqPayload))
      }

      await Promise.all(tasks)
      qc.invalidateQueries({ queryKey: ['settings'] })
      qc.invalidateQueries({ queryKey: ['qq-settings'] })
      qc.invalidateQueries({ queryKey: ['qq-status'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      alert(`保存失败: ${msg}`)
    } finally {
      setIsSaving(false)
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

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [key]: e.target.value }))
  const setQQ = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setQQForm(f => ({ ...f, [key]: e.target.value }))
  const toggleQQ = (key: string) => (checked: boolean | 'indeterminate') =>
    setQQForm(f => ({ ...f, [key]: checked === true }))
  const setQQAllowlist = (key: 'user_allowlist' | 'group_allowlist') => (tags: string[]) =>
    setQQForm(f => ({ ...f, [key]: tags }))

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
        api_key: form.openai_api_key !== settings?.openai_api_key ? form.openai_api_key : undefined,
      })
      const list = res.models || []
      // Preserve currently selected models in list if not in list
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

  const fetchBadge = (s: FetchState) => {
    if (s.status === 'idle') return null
    if (s.status === 'loading') return <span className="text-xs text-muted-foreground">获取模型中…</span>
    if (s.status === 'ok') return <span className="text-xs text-emerald-600 dark:text-emerald-400 break-all">{s.msg}</span>
    return <span className="text-xs text-destructive break-all">{s.msg}</span>
  }

  const qqStatusLabel: Record<string, string> = {
    disabled: '未启用',
    connecting: '连接中',
    connected: '已连接',
    error: '连接失败',
  }
  const qqStatusColor: Record<string, string> = {
    disabled: 'bg-muted-foreground',
    connecting: 'bg-amber-500',
    connected: 'bg-emerald-500',
    error: 'bg-destructive',
  }
  const status = qqStatus?.status || 'disabled'

  return (
    <div className="p-8 w-[860px] max-w-full mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">全局设置</h1>
          <p className="text-sm text-muted-foreground mt-1">配置大模型服务商、嵌入模型及 RAG 核心管道参数</p>
        </div>
        <Button
          onClick={handleSaveAll}
          disabled={isSaving}
          className="rounded-xl bg-foreground text-background hover:opacity-90 gap-2 shadow-xs"
        >
          {saved ? <Check className="h-4 w-4 text-emerald-400" /> : <Save className="h-4 w-4" />}
          {isSaving ? '保存中…' : saved ? '已保存设置' : '保存设置'}
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
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Radio className="w-4 h-4 text-foreground" />
              <CardTitle className="text-base font-semibold">QQ Bot 官方通道</CardTitle>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 text-xs font-mono px-2.5 py-1 rounded-full bg-secondary/60 border border-border/60" aria-live="polite">
                <span className={`h-2 w-2 rounded-full ${qqStatusColor[status] || 'bg-muted-foreground'}`} aria-hidden="true" />
                <span className="text-muted-foreground">{qqStatusLabel[status] || status}</span>
              </div>
              <div className="flex items-center gap-2 pl-2 border-l border-border">
                <Switch
                  id="qq-enable-switch"
                  checked={Boolean(qqForm.enabled)}
                  onCheckedChange={checked => setQQForm(f => ({ ...f, enabled: checked }))}
                />
                <Label htmlFor="qq-enable-switch" className="text-xs font-medium cursor-pointer">
                  {qqForm.enabled ? '通道开启' : '通道关闭'}
                </Label>
              </div>
            </div>
          </div>
          <CardDescription>通过 QQ 官方 Bot API 接入系统 Agent。群聊会话按群共享，群审批默认关闭。</CardDescription>
          {status === 'error' && qqStatus?.last_error && (
            <div className="mt-2 text-xs text-destructive break-all bg-destructive/10 p-2.5 rounded-xl border border-destructive/20">
              {qqStatus.last_error}
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">App ID</Label>
              <Input
                value={String(qqForm.app_id || '')}
                onChange={setQQ('app_id')}
                placeholder="在 QQ 开放平台申请的机器人 AppID"
                className="rounded-xl border-border bg-background font-mono text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Client Secret</Label>
              <Input
                type="password"
                value={String(qqForm.client_secret || '')}
                onChange={setQQ('client_secret')}
                placeholder="留空保持当前密钥"
                className="rounded-xl border-border bg-background font-mono text-sm"
              />
            </div>
          </div>

          <div className="space-y-4 pt-1 border-t border-border">
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">通道响应策略</Label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                {([
                  ['c2c_enabled', '启用私聊 (C2C)', '允许用户向机器人发起单聊对话'],
                  ['group_enabled', '启用群聊 (Group)', '允许机器人在加入的 QQ 群中响应'],
                  ['group_require_mention', '群聊要求 @ 机器人', '开启时只有被 @ 时才响应群消息'],
                ] as const).map(([key, label, desc]) => (
                  <label
                    key={key}
                    className="flex items-start gap-2.5 p-3 rounded-xl border border-border/70 bg-accent/20 hover:bg-accent/40 cursor-pointer transition-colors"
                  >
                    <Checkbox
                      checked={Boolean(qqForm[key])}
                      onCheckedChange={toggleQQ(key)}
                      className="mt-0.5"
                    />
                    <div className="space-y-0.5 select-none">
                      <span className="text-xs font-medium text-foreground block">{label}</span>
                      <span className="text-[11px] text-muted-foreground block leading-relaxed">{desc}</span>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">访问控制与安全审批</Label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                {([
                  ['allow_unlisted_users', '允许未列入白名单的用户', '开启后任意用户均可私聊；关闭后未授权用户将收到自身 OpenID 提示'],
                  ['allow_unlisted_groups', '允许未列入白名单的群', '开启后任意群均可响应；关闭后未授权群将收到群 OpenID 提示'],
                  ['group_approval_enabled', '启用群聊操作审批', '允许群成员直接交互审批敏感操作卡片'],
                ] as const).map(([key, label, desc]) => (
                  <label
                    key={key}
                    className="flex items-start gap-2.5 p-3 rounded-xl border border-border/70 bg-accent/20 hover:bg-accent/40 cursor-pointer transition-colors"
                  >
                    <Checkbox
                      checked={Boolean(qqForm[key])}
                      onCheckedChange={toggleQQ(key)}
                      className="mt-0.5"
                    />
                    <div className="space-y-0.5 select-none">
                      <span className="text-xs font-medium text-foreground block">{label}</span>
                      <span className="text-[11px] text-muted-foreground block leading-relaxed">{desc}</span>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">用户白名单 (User OpenID)</Label>
                {Boolean(qqForm.allow_unlisted_users) && (
                  <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">当前允许未列入用户</span>
                )}
              </div>
              <TagInput
                value={Array.isArray(qqForm.user_allowlist) ? (qqForm.user_allowlist as string[]) : []}
                onChange={setQQAllowlist('user_allowlist')}
                placeholder="输入 32 位 User OpenID，回车添加或直接粘贴"
              />
              <p className="text-[11px] text-muted-foreground leading-normal">
                需关闭「允许未列入白名单的用户」生效。未授权用户私聊时，机器人会自动回复其 OpenID 以便复制添加。
              </p>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">群白名单 (Group OpenID)</Label>
                {Boolean(qqForm.allow_unlisted_groups) && (
                  <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">当前允许未列入群</span>
                )}
              </div>
              <TagInput
                value={Array.isArray(qqForm.group_allowlist) ? (qqForm.group_allowlist as string[]) : []}
                onChange={setQQAllowlist('group_allowlist')}
                placeholder="输入 32 位 Group OpenID，回车添加或直接粘贴"
              />
              <p className="text-[11px] text-muted-foreground leading-normal">
                需关闭「允许未列入白名单的群」生效。未授权群内 @ 机器人时，机器人会自动回复该群 OpenID。
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-border">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">并发队列大小</Label>
              <Input type="number" min="1" value={String(qqForm.max_queue_size || '32')} onChange={setQQ('max_queue_size')} className="rounded-xl border-border bg-background font-mono text-sm" />
              <p className="text-[11px] text-muted-foreground">单个会话通道等待处理的最大消息堆叠数</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">执行超时（秒）</Label>
              <Input type="number" min="1" value={String(qqForm.run_timeout_seconds || '300')} onChange={setQQ('run_timeout_seconds')} className="rounded-xl border-border bg-background font-mono text-sm" />
              <p className="text-[11px] text-muted-foreground">单条消息调用 Agent/RAG 回复的最大等待时长</p>
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
      <Card className="rounded-2xl border-border bg-card shadow-xs">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-destructive" />
            <CardTitle className="text-base font-semibold">主机危险命令黑名单</CardTitle>
          </div>
          <CardDescription>每行一个正则表达式。命中黑名单的命令在任何模式下均被严格禁止执行，即使人工审批也无法放行</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <Textarea
            placeholder="\\brm\\s+-.*\\s+/\n\\bmkfs\\b\n\\bfdisk\\b\n\\bdd\\s+if=.*of=/dev/\n\\b(?:reboot|shutdown|poweroff)\\b"
            value={form.host_dangerous_patterns ?? ''}
            onChange={set('host_dangerous_patterns')}
            rows={6}
            className="rounded-xl border-border bg-background font-mono text-xs leading-relaxed"
          />
          <p className="text-[11px] text-muted-foreground">支持标准正则表达式，用于严格拦截 rm -rf /、mkfs、dd、reboot 等毁灭性系统指令。</p>
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
              className="gap-2 rounded-xl h-8 text-xs"
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