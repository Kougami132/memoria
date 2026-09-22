import { useState, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { TagInput } from '@/components/ui/tag-input'
import { Radio, Save, Check, ShieldCheck, Users, MessageSquare } from 'lucide-react'
import * as api from '@/api'
import type { QQSettings, QQSettingsUpdate } from '@/api'

interface QQBotTabProps {
  qqSettings?: QQSettings
}

export default function QQBotTab({ qqSettings }: QQBotTabProps) {
  const qc = useQueryClient()
  const { data: qqStatus } = useQuery({
    queryKey: ['qq-status'],
    queryFn: api.getQQStatus,
    refetchInterval: 3000,
  })

  const [qqForm, setQQForm] = useState<Partial<Record<string, string | boolean | string[]>>>({})
  const [saved, setSaved] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const hasInitializedRef = useRef(false)

  useEffect(() => {
    if (qqSettings && !hasInitializedRef.current) {
      hasInitializedRef.current = true
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

  const setQQ = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setQQForm(f => ({ ...f, [key]: e.target.value }))
  const toggleQQ = (key: string) => (checked: boolean | 'indeterminate') =>
    setQQForm(f => ({ ...f, [key]: checked === true }))
  const setQQAllowlist = (key: 'user_allowlist' | 'group_allowlist') => (tags: string[]) =>
    setQQForm(f => ({ ...f, [key]: tags }))

  const handleSave = async () => {
    setIsSaving(true)
    try {
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

      await api.updateQQSettings(qqPayload)
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">QQ Bot 官方通道设置</h2>
          <p className="text-sm text-muted-foreground mt-0.5">配置腾讯 QQ 开放平台官方 WebSocket 消息通道凭据、会话策略与白名单</p>
        </div>
        <Button
          onClick={handleSave}
          disabled={isSaving}
          className="rounded-xl bg-foreground text-background hover:opacity-90 gap-2 shadow-xs cursor-pointer"
        >
          {saved ? <Check className="h-4 w-4 text-emerald-400" /> : <Save className="h-4 w-4" />}
          {isSaving ? '保存中…' : saved ? '已保存通道配置' : '保存通道配置'}
        </Button>
      </div>

      <Card className="rounded-2xl border-border bg-card shadow-xs">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Radio className="w-4 h-4 text-foreground" />
              <CardTitle className="text-base font-semibold">网关通道状态与认证凭据</CardTitle>
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
          <CardDescription>
            通过 QQ 开放平台官方 WebSocket 网关接入。单聊为独立用户会话，群聊消息按群共享上下文。
          </CardDescription>
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
              <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                <MessageSquare className="w-3.5 h-3.5" />
                <span>通道响应策略</span>
              </div>
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
              <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>访问控制与安全审批</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                {([
                  ['allow_unlisted_users', '允许未列入白名单的用户', '开启后任意用户均可私聊；关闭后未授权用户将收到自身 OpenID 提示'],
                  ['allow_unlisted_groups', '允许未列入白名单的群', '开启后任意群均可响应；关闭后未授权群将收到群 OpenID 提示'],
                  ['group_approval_enabled', '启用群聊操作审批', '允许群成员直接交互审批敏感主机操作卡片'],
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
                <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  <Users className="w-3.5 h-3.5" />
                  <span>用户白名单 (User OpenID)</span>
                </div>
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
                <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  <Users className="w-3.5 h-3.5" />
                  <span>群白名单 (Group OpenID)</span>
                </div>
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
              <Input
                type="number"
                min="1"
                value={String(qqForm.max_queue_size || '32')}
                onChange={setQQ('max_queue_size')}
                className="rounded-xl border-border bg-background font-mono text-sm"
              />
              <p className="text-[11px] text-muted-foreground">单个会话通道等待处理的最大消息堆叠数</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">执行超时（秒）</Label>
              <Input
                type="number"
                min="1"
                value={String(qqForm.run_timeout_seconds || '300')}
                onChange={setQQ('run_timeout_seconds')}
                className="rounded-xl border-border bg-background font-mono text-sm"
              />
              <p className="text-[11px] text-muted-foreground">单条消息调用 Agent/RAG 回复的最大等待时长</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
