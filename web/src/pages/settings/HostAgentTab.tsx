import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ShieldAlert, Server, Save, Check, ArrowRight, RotateCcw, Shield, CheckCircle2, AlertTriangle, Flame } from 'lucide-react'
import * as api from '@/api'
import type { Settings, SettingsUpdate } from '@/api'
import { RECOMMENDED_HOST_DANGEROUS_PATTERNS } from './constants'

interface HostAgentTabProps {
  settings?: Settings
}

export default function HostAgentTab({ settings }: HostAgentTabProps) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [patternsText, setPatternsText] = useState('')
  const [saved, setSaved] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const hasInitializedRef = useRef(false)

  useEffect(() => {
    if (settings && !hasInitializedRef.current) {
      hasInitializedRef.current = true
      let text = ''
      if (settings.host_dangerous_patterns) {
        try {
          const parsed = JSON.parse(settings.host_dangerous_patterns)
          if (Array.isArray(parsed)) {
            text = parsed.join('\n')
          } else {
            text = String(settings.host_dangerous_patterns)
          }
        } catch {
          text = settings.host_dangerous_patterns
        }
      } else {
        text = RECOMMENDED_HOST_DANGEROUS_PATTERNS.join('\n')
      }
      setPatternsText(text)
    }
  }, [settings])

  const handleResetToRecommended = () => {
    setPatternsText(RECOMMENDED_HOST_DANGEROUS_PATTERNS.join('\n'))
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const patterns = patternsText
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)

      const payload: SettingsUpdate = {
        host_dangerous_patterns: patterns,
      }

      await api.updateSettings(payload)
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">主机运维专员设置 (HostAgent)</h2>
          <p className="text-sm text-muted-foreground mt-0.5">配置受控服务器命令安全审查规则与 CommandGuard 高危硬拦截黑名单</p>
        </div>
        <Button
          onClick={handleSave}
          disabled={isSaving}
          className="rounded-xl bg-foreground text-background hover:opacity-90 gap-2 shadow-xs cursor-pointer"
        >
          {saved ? <Check className="h-4 w-4 text-emerald-400" /> : <Save className="h-4 w-4" />}
          {isSaving ? '保存中…' : saved ? '已保存专员配置' : '保存专员配置'}
        </Button>
      </div>

      {/* Safety framework and execution mode card */}
      <Card className="rounded-2xl border-border bg-card shadow-xs">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-foreground" />
            <CardTitle className="text-base font-semibold">CommandGuard 审查体系与三级安全模式</CardTitle>
          </div>
          <CardDescription>
            HostAgent 在受控 SSH 主机上执行的所有诊断和运维操作均受到系统内核级安全策略防护
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="p-3.5 rounded-xl border border-emerald-500/30 bg-emerald-50/40 dark:bg-emerald-950/20 space-y-1.5">
              <div className="flex items-center gap-1.5 font-semibold text-xs text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>只读安全模式 (read_only)</span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                仅放行预置安全探针指令（如 <code>df</code>, <code>ps</code>, <code>uptime</code>），任何写操作或环境修改指令均在内核硬拦截。
              </p>
            </div>

            <div className="p-3.5 rounded-xl border border-blue-500/30 bg-blue-50/40 dark:bg-blue-950/20 space-y-1.5">
              <div className="flex items-center gap-1.5 font-semibold text-xs text-blue-600 dark:text-blue-400">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>审批确认模式 (ask_confirmation)</span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                推荐模式。安全查询自动秒级执行；写与变更指令挂起并向 Web / QQ 通道生成审批卡片，经人工授权后方可执行。
              </p>
            </div>

            <div className="p-3.5 rounded-xl border border-amber-500/30 bg-amber-50/40 dark:bg-amber-950/20 space-y-1.5">
              <div className="flex items-center gap-1.5 font-semibold text-xs text-amber-600 dark:text-amber-400">
                <Flame className="w-3.5 h-3.5" />
                <span>自由执行模式 (unrestricted)</span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                允许自动执行探针与写操作，但仍受下方高危黑名单强制保护。适合经过充分测试的受控封闭脚本环境。
              </p>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-xs text-destructive flex items-start gap-2.5">
            <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="leading-relaxed">
              <strong>硬拦截红线原则：</strong>无论主机当前配置何种模式，凡命中下方全局黑名单的毁灭性指令，系统一律强制熔断，<strong>即使人工手动审批也绝对无法放行</strong>。
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Server className="w-4 h-4 text-foreground" />
              <span>受控主机连接、SSH 凭据加密与单机模式覆盖在主机管理维护</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/hosts')}
              className="gap-1.5 rounded-xl border-border text-xs cursor-pointer"
            >
              <Server className="w-3.5 h-3.5" />
              前往主机管理
              <ArrowRight className="w-3 h-3 ml-0.5" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* High-risk blacklist editor */}
      <Card className="rounded-2xl border-border bg-card shadow-xs">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-destructive" />
              <CardTitle className="text-base font-semibold">主机高危命令全局正则黑名单 (host_dangerous_patterns)</CardTitle>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleResetToRecommended}
              className="gap-1.5 rounded-xl border-border text-xs cursor-pointer"
              title="重置为系统预置的安全正则列表"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              恢复推荐黑名单
            </Button>
          </div>
          <CardDescription>
            每行一条正则表达式。命中该黑名单的指令在任何安全模式下均直接拒绝执行，从内核底层彻底杜绝主机自毁风险。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Textarea
            value={patternsText}
            onChange={e => setPatternsText(e.target.value)}
            rows={10}
            className="rounded-xl border-border bg-background font-mono text-xs leading-relaxed"
            placeholder="每行一个正则表达式，例如：\brm\s+-.*[rf]\s+/"
          />
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>支持标准 Python / POSIX 正则语法。空行将被自动过滤。</span>
            <Badge variant="secondary" className="font-mono text-[10px]">
              当前规则数: {patternsText.split('\n').filter(s => s.trim().length > 0).length} 条
            </Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
