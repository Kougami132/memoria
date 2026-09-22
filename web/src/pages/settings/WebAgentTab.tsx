import { useState, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Globe, Save, Check, ShieldCheck, Key, Link2, Info } from 'lucide-react'
import * as api from '@/api'
import type { Settings, SettingsUpdate } from '@/api'

interface WebAgentTabProps {
  settings?: Settings
}

export default function WebAgentTab({ settings }: WebAgentTabProps) {
  const qc = useQueryClient()
  const [form, setForm] = useState<{
    enable_web_search: boolean
    web_search_provider: string
    web_search_api_key: string
    web_search_endpoint: string
  }>({
    enable_web_search: false,
    web_search_provider: 'duckduckgo',
    web_search_api_key: '',
    web_search_endpoint: '',
  })
  const [saved, setSaved] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const hasInitializedRef = useRef(false)

  useEffect(() => {
    if (settings && !hasInitializedRef.current) {
      hasInitializedRef.current = true
      setForm({
        enable_web_search: settings.enable_web_search === 'true' || settings.enable_web_search === true,
        web_search_provider: settings.web_search_provider || 'duckduckgo',
        web_search_api_key: settings.web_search_api_key ?? '',
        web_search_endpoint: settings.web_search_endpoint ?? '',
      })
    }
  }, [settings])

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const payload: SettingsUpdate = {
        enable_web_search: form.enable_web_search,
        web_search_provider: form.web_search_provider,
        web_search_api_key: form.web_search_api_key,
        web_search_endpoint: form.web_search_endpoint,
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
          <h2 className="text-xl font-bold tracking-tight">联网搜索专员设置 (WebAgent)</h2>
          <p className="text-sm text-muted-foreground mt-0.5">配置外部互联网搜索引擎服务商、自建端点与 API 密钥凭据</p>
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

      <Card className="rounded-2xl border-border bg-card shadow-xs">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-foreground" />
              <CardTitle className="text-base font-semibold">联网搜索智能体状态与提供商</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="enable-webagent-switch"
                checked={form.enable_web_search}
                onCheckedChange={checked => setForm(f => ({ ...f, enable_web_search: checked }))}
              />
              <Label htmlFor="enable-webagent-switch" className="text-xs font-medium cursor-pointer">
                {form.enable_web_search ? '专员已启用' : '专员已停用'}
              </Label>
            </div>
          </div>
          <CardDescription>
            为系统 Multi-Agent 体系开启外网事实检索能力。编排器可通过 <code>delegate_to_web_agent</code> 委托最新资讯检索。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {!form.enable_web_search ? (
            <div className="p-4 rounded-xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-500/20 flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                  Local-First 离线保护中
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  联网搜索专员已处于关闭状态。系统对话与 Agent 决策将 100% 依赖本地私有知识库与已有知识，绝不产生任何外网搜索请求，杜绝模型幻觉与信息泄露风险。
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4 pt-1">
              <div className="space-y-1.5 max-w-sm">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  搜索引擎服务商 (Search Provider)
                </Label>
                <select
                  value={form.web_search_provider}
                  onChange={e => setForm(f => ({ ...f, web_search_provider: e.target.value }))}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-hidden"
                >
                  <option value="duckduckgo">DuckDuckGo (无需密钥 / 免配置直连)</option>
                  <option value="searxng">SearXNG (自建私有开源元搜索引擎)</option>
                  <option value="tavily">Tavily (专为 AI Agent 优化的搜索 API)</option>
                  <option value="serpapi">SerpAPI (Google 搜索结构化 API)</option>
                </select>
              </div>

              {form.web_search_provider === 'duckduckgo' && (
                <div className="p-3.5 rounded-xl bg-secondary/60 border border-border/80 flex items-start gap-2.5 text-xs text-muted-foreground">
                  <Info className="w-4 h-4 text-foreground shrink-0 mt-0.5" />
                  <div className="leading-relaxed">
                    <strong>DuckDuckGo 免密直连：</strong>无需申请或配置任何第三方 API 密钥，服务在发起搜索时直接通过 DuckDuckGo 公共端点提取前排网页与摘要信息，即开即用。
                  </div>
                </div>
              )}

              {form.web_search_provider === 'searxng' && (
                <div className="space-y-3 p-4 rounded-xl border border-border bg-accent/10">
                  <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                    <Link2 className="w-4 h-4" />
                    <span>SearXNG 私有实例配置</span>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      SearXNG 服务地址 (Endpoint)
                    </Label>
                    <Input
                      placeholder="http://localhost:8080"
                      value={form.web_search_endpoint}
                      onChange={e => setForm(f => ({ ...f, web_search_endpoint: e.target.value }))}
                      className="rounded-xl border-border bg-background font-mono text-sm"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      填写私有 Docker 部署或内部局域网运行的 SearXNG 实例根地址（例如 <code>http://192.168.1.100:8080</code>）。
                    </p>
                  </div>
                </div>
              )}

              {(form.web_search_provider === 'tavily' || form.web_search_provider === 'serpapi') && (
                <div className="space-y-3 p-4 rounded-xl border border-border bg-accent/10">
                  <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                    <Key className="w-4 h-4" />
                    <span>{form.web_search_provider === 'tavily' ? 'Tavily' : 'SerpAPI'} 认证凭据</span>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      API 密钥 (API Key)
                    </Label>
                    <Input
                      type="password"
                      placeholder={form.web_search_provider === 'tavily' ? 'tvly-xxxxxxxxxxxx' : 'SerpAPI Secret Key'}
                      value={form.web_search_api_key}
                      onChange={e => setForm(f => ({ ...f, web_search_api_key: e.target.value }))}
                      className="rounded-xl border-border bg-background font-mono text-sm"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      {form.web_search_provider === 'tavily'
                        ? '请在 tavily.com 控制台获取以 tvly- 开头的 API 密钥'
                        : '请在 serpapi.com 用户仪表盘复制您的个人 Private Key'}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
