import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Server,
  Plus,
  Trash2,
  Pencil,
  X,
  Check,
  ShieldCheck,
  ShieldAlert,
  Activity,
  Terminal,
  Key,
  Lock,
  Loader2,
} from 'lucide-react'
import * as api from '@/api'
import type { Host as HostType, HostCreate, HostUpdate } from '@/api'

function HostForm({
  initial,
  onSubmit,
  onCancel,
  isPending,
}: {
  initial?: HostType
  onSubmit: (data: HostCreate | HostUpdate) => void
  onCancel?: () => void
  isPending: boolean
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [host, setHost] = useState(initial?.host ?? '')
  const [port, setPort] = useState(initial?.port ? String(initial.port) : '22')
  const [username, setUsername] = useState(initial?.username ?? 'root')
  const [authType, setAuthType] = useState<'password' | 'key'>(initial?.auth_type ?? 'password')
  const [credential, setCredential] = useState('')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [tagsInput, setTagsInput] = useState(initial?.tags?.join(', ') ?? '')
  const [safeMode, setSafeMode] = useState(initial?.safe_mode ?? true)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !host.trim() || !username.trim()) return

    const tags = tagsInput
      .split(/[,，\s]+/)
      .map(t => t.trim())
      .filter(Boolean)

    const payload: HostCreate = {
      name: name.trim(),
      host: host.trim(),
      port: parseInt(port, 10) || 22,
      username: username.trim(),
      auth_type: authType,
      description: description.trim(),
      tags,
      safe_mode: safeMode,
    }

    if (credential.trim()) {
      payload.credential = credential.trim()
    }

    onSubmit(payload)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            主机别名 <span className="text-destructive">*</span>
          </Label>
          <Input
            placeholder="例如：生产服务器 / 数据库节点 01"
            value={name}
            onChange={e => setName(e.target.value)}
            className="rounded-xl border-border bg-background"
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            标签 <span className="normal-case font-normal text-muted-foreground">(英文或逗号分隔)</span>
          </Label>
          <Input
            placeholder="prod, gpu, web, cluster"
            value={tagsInput}
            onChange={e => setTagsInput(e.target.value)}
            className="rounded-xl border-border bg-background"
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2 space-y-1.5">
          <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            IP 地址 / 域名 <span className="text-destructive">*</span>
          </Label>
          <Input
            placeholder="192.168.1.100 或 server.example.com"
            value={host}
            onChange={e => setHost(e.target.value)}
            className="rounded-xl border-border bg-background font-mono text-sm"
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            SSH 端口
          </Label>
          <Input
            type="number"
            placeholder="22"
            value={port}
            onChange={e => setPort(e.target.value)}
            className="rounded-xl border-border bg-background font-mono text-sm"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            SSH 登录用户 <span className="text-destructive">*</span>
          </Label>
          <Input
            placeholder="root / ubuntu / debian"
            value={username}
            onChange={e => setUsername(e.target.value)}
            className="rounded-xl border-border bg-background font-mono text-sm"
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            认证方式
          </Label>
          <div className="flex gap-2">
            <Button
              type="button"
              variant={authType === 'password' ? 'default' : 'outline'}
              className="flex-1 rounded-xl text-xs gap-1.5"
              onClick={() => setAuthType('password')}
            >
              <Lock className="w-3.5 h-3.5" />
              密码认证
            </Button>
            <Button
              type="button"
              variant={authType === 'key' ? 'default' : 'outline'}
              className="flex-1 rounded-xl text-xs gap-1.5"
              onClick={() => setAuthType('key')}
            >
              <Key className="w-3.5 h-3.5" />
              私钥认证
            </Button>
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {authType === 'password' ? 'SSH 密码' : 'SSH 私钥内容 (OpenSSH / RSA / ED25519)'}
          {initial?.credential_set && !credential && (
            <span className="ml-2 normal-case text-[11px] text-green-600 dark:text-green-400 font-normal">
              (已保存凭据，留空表示保持不变)
            </span>
          )}
        </Label>
        {authType === 'password' ? (
          <Input
            type="password"
            placeholder={initial?.credential_set ? '•••••••• (保持原密码)' : '输入远程登录密码'}
            value={credential}
            onChange={e => setCredential(e.target.value)}
            className="rounded-xl border-border bg-background"
          />
        ) : (
          <Textarea
            placeholder={
              initial?.credential_set
                ? '-----BEGIN OPENSSH PRIVATE KEY-----\n••••••••\n-----END OPENSSH PRIVATE KEY-----\n(保持原私钥)'
                : '-----BEGIN OPENSSH PRIVATE KEY-----\n...\n-----END OPENSSH PRIVATE KEY-----'
            }
            value={credential}
            onChange={e => setCredential(e.target.value)}
            rows={4}
            className="rounded-xl border-border bg-background font-mono text-xs leading-relaxed"
          />
        )}
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          描述信息 (可选)
        </Label>
        <Input
          placeholder="说明主机用途、机房位置或环境"
          value={description}
          onChange={e => setDescription(e.target.value)}
          className="rounded-xl border-border bg-background"
        />
      </div>

      {/* Safe Mode Toggle */}
      <div className="flex items-start gap-3 p-3.5 rounded-xl border border-border/80 bg-accent/30">
        <Checkbox
          id="safe-mode"
          checked={safeMode}
          onCheckedChange={checked => setSafeMode(!!checked)}
          className="mt-0.5"
        />
        <div className="space-y-1 leading-none cursor-pointer" onClick={() => setSafeMode(!safeMode)}>
          <label htmlFor="safe-mode" className="text-sm font-semibold text-foreground cursor-pointer flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            启用安全只读保护 (Safe Mode - 强烈推荐)
          </label>
          <p className="text-xs text-muted-foreground leading-normal">
            开启后，常规对话与 Agent 仅能执行只读检测命令（如 top, ps, df, uptime, docker ps, free, cat 日志等），严禁任何 rm, kill, reboot, iptables, dd 等破坏性操作。
          </p>
        </div>
      </div>

      <div className="flex gap-2 pt-2">
        <Button
          type="submit"
          disabled={!name.trim() || !host.trim() || !username.trim() || isPending}
          className="rounded-xl bg-foreground text-background hover:opacity-90 gap-1.5"
        >
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          {initial ? '保存主机配置' : '添加主机'}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} className="rounded-xl border-border gap-1.5">
            <X className="h-3.5 w-3.5" />
            取消
          </Button>
        )}
      </div>
    </form>
  )
}

export default function Hosts() {
  const qc = useQueryClient()
  const { data: hosts = [], isPending } = useQuery({ queryKey: ['hosts'], queryFn: api.listHosts })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ id: string; result: api.TestHostResult } | null>(null)

  const createHost = useMutation({
    mutationFn: api.createHost,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hosts'] })
      setShowCreate(false)
    },
  })

  const updateHost = useMutation({
    mutationFn: ({ id, data }: { id: string; data: api.HostUpdate }) => api.updateHost(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hosts'] })
      setEditingId(null)
    },
  })

  const deleteHost = useMutation({
    mutationFn: api.deleteHost,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hosts'] }),
  })

  const handleTestConnection = async (hostItem: HostType) => {
    setTestingId(hostItem.id)
    setTestResult(null)
    try {
      const res = await api.testHostConnection(hostItem.id)
      setTestResult({ id: hostItem.id, result: res })
      qc.invalidateQueries({ queryKey: ['hosts'] })
    } catch (err: any) {
      setTestResult({
        id: hostItem.id,
        result: { ok: false, message: err.message || '连接测试失败' },
      })
    } finally {
      setTestingId(null)
    }
  }

  return (
    <div className="p-8 w-[880px] max-w-full mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">主机管理 (SSH Hosts)</h1>
          <p className="text-sm text-muted-foreground mt-1">
            配置可供对话与 Agent 调用的 Linux / Unix 远程主机，支持内置只读保护与凭据加密
          </p>
        </div>
        <Button
          onClick={() => setShowCreate(v => !v)}
          className="rounded-xl bg-foreground text-background hover:opacity-90 gap-2 shrink-0 shadow-xs"
        >
          <Plus className="h-4 w-4" />
          添加主机
        </Button>
      </div>

      {showCreate && (
        <Card className="rounded-2xl border-border bg-card shadow-sm">
          <CardContent className="p-6">
            <h3 className="font-semibold text-base mb-4">添加新 SSH 主机</h3>
            <HostForm
              onSubmit={data => createHost.mutate(data as HostCreate)}
              onCancel={() => setShowCreate(false)}
              isPending={createHost.isPending}
            />
          </CardContent>
        </Card>
      )}

      {hosts.length === 0 && !isPending ? (
        <div className="flex flex-col items-center justify-center py-24 text-center rounded-2xl border border-dashed border-border/80">
          <div className="w-12 h-12 rounded-2xl bg-secondary flex items-center justify-center text-muted-foreground mb-4">
            <Server className="h-6 w-6" />
          </div>
          <p className="font-semibold text-base">暂无配置的主机</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">
            添加 SSH 服务器后，可以在 Bots 助手或 Agent 中直接查询主机运行状态、服务进程与日志。
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {hosts.map(hostItem => {
            const isEditing = editingId === hostItem.id
            const isTesting = testingId === hostItem.id
            const currentTestRes = testResult?.id === hostItem.id ? testResult.result : null

            return (
              <div
                key={hostItem.id}
                className="group rounded-2xl border border-border bg-card hover:border-foreground/20 transition-all p-5 shadow-xs space-y-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3.5">
                    <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center shrink-0 mt-0.5">
                      <Server className="h-5 w-5 text-foreground" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-base text-foreground">{hostItem.name}</h3>
                        {hostItem.safe_mode ? (
                          <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 gap-1 py-0.5">
                            <ShieldCheck className="w-3 h-3" />
                            只读安全模式
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30 gap-1 py-0.5">
                            <ShieldAlert className="w-3 h-3" />
                            全权模式
                          </Badge>
                        )}
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${
                          hostItem.status === 'active'
                            ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300'
                            : hostItem.status === 'error'
                            ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
                            : 'bg-muted text-muted-foreground'
                        }`}>
                          {hostItem.status === 'active' ? '在线' : hostItem.status === 'error' ? '连接异常' : '未连接'}
                        </span>
                      </div>

                      <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono mt-1">
                        <span>{hostItem.username}@{hostItem.host}:{hostItem.port}</span>
                        <span>•</span>
                        <span>{hostItem.auth_type === 'password' ? '密码认证' : '私钥认证'}</span>
                        {hostItem.credential_set && (
                          <span className="text-emerald-600 dark:text-emerald-400">已存凭据</span>
                        )}
                      </div>

                      {hostItem.description && (
                        <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                          {hostItem.description}
                        </p>
                      )}

                      {hostItem.os_info && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground/80 mt-2 font-mono bg-accent/40 px-2.5 py-1 rounded-lg">
                          <Terminal className="w-3 h-3 shrink-0" />
                          <span className="truncate">{hostItem.os_info}</span>
                        </div>
                      )}

                      {hostItem.tags && hostItem.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-3">
                          {hostItem.tags.map(tag => (
                            <Badge key={tag} variant="secondary" className="text-[11px] font-normal px-2 py-0.5 rounded-md">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isTesting}
                      onClick={() => handleTestConnection(hostItem)}
                      className="rounded-xl text-xs gap-1.5 h-8 px-2.5 border-border hover:bg-accent"
                      title="测试 SSH 连接与主机响应"
                    >
                      {isTesting ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Activity className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                      )}
                      测试连接
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
                      onClick={() => setEditingId(isEditing ? null : hostItem.id)}
                    >
                      {isEditing ? <X className="h-4 w-4" /> : <Pencil className="h-3.5 w-3.5" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-lg text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        if (confirm(`确认删除主机「${hostItem.name}」？`)) deleteHost.mutate(hostItem.id)
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {currentTestRes && (
                  <div className={`p-3 rounded-xl text-xs border ${
                    (currentTestRes.ok || (currentTestRes as any).status === "success")
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-300'
                      : 'bg-destructive/10 border-destructive/30 text-destructive'
                  }`}>
                    <div className="font-semibold flex items-center justify-between">
                      <span>{(currentTestRes.ok || (currentTestRes as any).status === "success") ? '✓ 连接测试成功' : '✗ 连接测试失败'}</span>
                      {currentTestRes.latency_ms !== undefined && (
                        <span className="font-mono">{currentTestRes.latency_ms} ms</span>
                      )}
                    </div>
                    {currentTestRes.os_info && (
                      <div className="mt-1 font-mono text-[11px]">{currentTestRes.os_info}</div>
                    )}
                    {currentTestRes.message && !(currentTestRes.ok || (currentTestRes as any).status === "success") && (
                      <div className="mt-1 break-all">{currentTestRes.message}</div>
                    )}
                  </div>
                )}

                {isEditing && (
                  <div className="pt-4 border-t border-border">
                    <HostForm
                      initial={hostItem}
                      onSubmit={data => updateHost.mutate({ id: hostItem.id, data })}
                      onCancel={() => setEditingId(null)}
                      isPending={updateHost.isPending}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
