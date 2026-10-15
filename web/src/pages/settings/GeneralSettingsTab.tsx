import { useState, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { PasswordInput } from '@/components/ui/password-input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Save,
  Check,
  MessageSquareCode,
  Download,
  Database,
  Upload,
  AlertCircle,
  ShieldCheck,
  Copy,
  Wand2,
} from 'lucide-react'
import * as api from '@/api'
import type { Settings, SettingsUpdate } from '@/api'

interface GeneralSettingsTabProps {
  settings?: Settings
}

export default function GeneralSettingsTab({ settings }: GeneralSettingsTabProps) {
  const qc = useQueryClient()
  const [form, setForm] = useState<Partial<Record<string, string>>>({})
  const [saved, setSaved] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [copiedCurl, setCopiedCurl] = useState(false)
  const [backupRestoreState, setBackupRestoreState] = useState<{
    status: 'idle' | 'loading' | 'success' | 'error'
    msg: string
  }>({ status: 'idle', msg: '' })

  const initialBaselineRef = useRef<{ external_api_token?: string }>({})
  const hasInitializedRef = useRef(false)

  useEffect(() => {
    if (settings && !hasInitializedRef.current) {
      hasInitializedRef.current = true
      initialBaselineRef.current = {
        external_api_token: settings.external_api_token,
      }
      setForm({
        external_api_token: settings.external_api_token ?? '',
        system_prompt: settings.system_prompt ?? '',
      })
    }
  }, [settings])

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const payload: SettingsUpdate = {
        system_prompt: form.system_prompt,
      }
      if (form.external_api_token !== initialBaselineRef.current.external_api_token) {
        payload.external_api_token = form.external_api_token
      }

      await api.updateSettings(payload)
      initialBaselineRef.current = {
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

  const handleGenerateSecureToken = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
    let rand = ''
    const array = new Uint8Array(24)
    crypto.getRandomValues(array)
    for (let i = 0; i < array.length; i++) {
      rand += chars[array[i] % chars.length]
    }
    const token = `memoria_sec_${rand}`
    setForm((f) => ({ ...f, external_api_token: token }))
  }

  const handleCopyCurl = () => {
    const origin = window.location.origin
    const token = form.external_api_token ? form.external_api_token : 'YOUR_TOKEN'
    const snippet = `curl -X POST "${origin}/v1/chat/completions" \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer ${token}" \\\n  -d '{\n    "model": "${settings?.llm_model || 'deepseek-v4-flash'}",\n    "messages": [{"role": "user", "content": "你好"}]\n  }'`
    navigator.clipboard.writeText(snippet)
    setCopiedCurl(true)
    setTimeout(() => setCopiedCurl(false), 2500)
  }

  const handleImportBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!confirm('恢复备份将覆盖当前系统的数据库、向量检索切片及上传文件。确认继续导入？')) {
      e.target.value = ''
      return
    }
    setBackupRestoreState({ status: 'loading', msg: '正在导入恢复数据包…' })
    try {
      const res = await api.importBackup(file)
      setBackupRestoreState({
        status: 'success',
        msg: `恢复成功！恢复了 ${res.kbs_count} 个知识库，${res.vaults_count} 个笔记仓库。若新机网络或挂载路径变动，请至知识库管理页修改 Vault 配置。`,
      })
      qc.invalidateQueries()
    } catch (err: any) {
      setBackupRestoreState({ status: 'error', msg: `导入失败: ${err.message || err}` })
    } finally {
      e.target.value = ''
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">通用与安全设置</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            管理外部 API 接入安全鉴权、系统通用提示词及全量数据冷备份
          </p>
        </div>
        <Button
          onClick={handleSave}
          disabled={isSaving}
          className="rounded-xl bg-foreground text-background hover:opacity-90 gap-2 shadow-xs cursor-pointer"
        >
          {saved ? <Check className="h-4 w-4 text-emerald-400" /> : <Save className="h-4 w-4" />}
          {isSaving ? '保存中…' : saved ? '已保存' : '保存'}
        </Button>
      </div>

      {/* 1. 外部 API 访问凭据 (External API Security) */}
      <Card className="rounded-2xl border-border bg-card shadow-xs">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <CardTitle className="text-base font-semibold">外部 API 访问凭据 (External API Security)</CardTitle>
          </div>
          <CardDescription>
            供第三方工具（如 NextChat、沉浸式翻译、Raycast、OpenWebUI 或移动端快捷指令）通过 Bearer Token 访问本系统 <code>/v1/chat/completions</code> 统一智能体服务
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                外部鉴权 Bearer Token
              </Label>
              <button
                type="button"
                onClick={handleGenerateSecureToken}
                className="text-xs text-primary hover:underline flex items-center gap-1 cursor-pointer font-medium"
              >
                <Wand2 className="w-3 h-3" />
                生成随机高强度 Token
              </button>
            </div>
            <PasswordInput
              placeholder="留空则不启用外部身份认证（允许任意匿名调用）"
              value={form.external_api_token ?? ''}
              onChange={set('external_api_token')}
              className="rounded-xl border-border bg-background font-mono text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              {form.external_api_token
                ? '已配置鉴权 Token：所有外部客户端在请求 /v1 接口时必须在 HTTP 请求头中附带 Authorization: Bearer <Token>'
                : '当前未配置 Token：外部请求无需验证身份即可直接调用'}
            </p>
          </div>

          <div className="pt-2 flex items-center justify-between border-t border-border">
            <span className="text-xs text-muted-foreground">需要接入指南或调试命令？</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopyCurl}
              className="gap-1.5 rounded-xl border-border text-xs cursor-pointer"
            >
              {copiedCurl ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedCurl ? '已复制调试命令' : '复制 cURL 请求示例'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 2. 系统通用提示词 */}
      <Card className="rounded-2xl border-border bg-card shadow-xs">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <MessageSquareCode className="w-4 h-4 text-foreground" />
            <CardTitle className="text-base font-semibold">系统通用提示词 (System Prompt)</CardTitle>
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

      {/* 3. 系统数据迁移与冷备份 */}
      <Card className="rounded-2xl border-border bg-card shadow-xs">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-foreground" />
            <CardTitle className="text-base font-semibold">系统数据迁移与冷备份</CardTitle>
          </div>
          <CardDescription>
            完整打包 SQLite 数据库、向量检索数据及上传文档，用于跨机器无损迁移并保留 Embedding 结果
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
            <div
              className={`p-3 rounded-xl text-xs border flex items-start gap-2 ${
                backupRestoreState.status === 'loading'
                  ? 'bg-muted/50 border-border text-foreground'
                  : backupRestoreState.status === 'success'
                  ? 'bg-emerald-50/50 border-emerald-300 text-emerald-700 dark:bg-emerald-950/20 dark:border-emerald-800 dark:text-emerald-300'
                  : 'bg-destructive/10 border-destructive/30 text-destructive'
              }`}
            >
              {backupRestoreState.status === 'success' ? (
                <Check className="w-4 h-4 shrink-0 mt-0.5" />
              ) : backupRestoreState.status === 'error' ? (
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              ) : (
                <Database className="w-4 h-4 shrink-0 mt-0.5 animate-spin" />
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
