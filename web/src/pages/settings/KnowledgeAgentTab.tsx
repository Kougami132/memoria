import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Database,
  Sliders,
  Save,
  Check,
  ArrowRight,
  Sparkles,
  BookOpen,
  Clock,
  RefreshCw,
} from 'lucide-react'
import * as api from '@/api'
import type { Settings, SettingsUpdate } from '@/api'

interface KnowledgeAgentTabProps {
  settings?: Settings
}

export default function KnowledgeAgentTab({ settings }: KnowledgeAgentTabProps) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [form, setForm] = useState<Partial<Record<string, string>>>({})
  const [saved, setSaved] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [triggering, setTriggering] = useState(false)
  const hasInitializedRef = useRef(false)

  const { data: schedulerStatus, refetch: refetchScheduler } = useQuery({
    queryKey: ['vault-scheduler'],
    queryFn: api.getVaultSchedulerStatus,
  })

  useEffect(() => {
    if (settings && !hasInitializedRef.current) {
      hasInitializedRef.current = true
      setForm({
        top_k: settings.top_k ?? '5',
        min_score: settings.min_score ?? '0.5',
        chunk_size: settings.chunk_size ?? '512',
        chunk_overlap: settings.chunk_overlap ?? '50',
        vault_sync_interval_minutes: settings.vault_sync_interval_minutes ?? '15',
      })
    }
  }, [settings])

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const payload: SettingsUpdate = {
        top_k: form.top_k ? Number(form.top_k) : undefined,
        min_score: form.min_score ? Number(form.min_score) : undefined,
        chunk_size: form.chunk_size ? Number(form.chunk_size) : undefined,
        chunk_overlap: form.chunk_overlap ? Number(form.chunk_overlap) : undefined,
        vault_sync_interval_minutes: form.vault_sync_interval_minutes
          ? Number(form.vault_sync_interval_minutes)
          : undefined,
      }

      await api.updateSettings(payload)
      qc.invalidateQueries({ queryKey: ['settings'] })
      qc.invalidateQueries({ queryKey: ['vault-scheduler'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      alert(`保存失败: ${msg}`)
    } finally {
      setIsSaving(false)
    }
  }

  const handleTriggerVaultSync = async () => {
    setTriggering(true)
    try {
      await api.triggerVaultScheduler()
      qc.invalidateQueries({ queryKey: ['vault'] })
      refetchScheduler()
      setTimeout(() => setTriggering(false), 1500)
    } catch (e: any) {
      alert(`触发全量同步失败: ${e.message || e}`)
      setTriggering(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">知识检索设置 (Knowledge & RAG)</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            调优 RAG 核心分块与混合召回参数，配置 Vault 笔记库自动索引同步
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

      {/* Specialist mechanism explanation card */}
      <Card className="rounded-2xl border-border bg-card shadow-xs">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-foreground" />
            <CardTitle className="text-base font-semibold">检索机制与知识来源</CardTitle>
          </div>
          <CardDescription>
            Multi-Agent 架构中由 Knowledge 领域扩展通过向量余弦与 FTS5 BM25 进行混合召回
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-3.5 rounded-xl bg-secondary/50 border border-border/80 text-xs text-muted-foreground leading-relaxed space-y-2">
            <p>
              <strong className="text-foreground">向量与全文混合检索：</strong>
              智能体在识别到用户提问涉及私有文档或参考资料时，会调用 <code>kb_search</code> 工具执行向量与 SQLite FTS5 BM25 的倒数秩融合（RRF）重排，过滤出高置信度切片以注入上下文。
            </p>
            <p>
              知识库支持手动上传文档（<code>.md</code>, <code>.txt</code>, <code>.pdf</code>, <code>.docx</code>）或绑定 Obsidian / 本地目录 / WebDAV 形式的 Vault 仓库自动增量更新。
            </p>
          </div>

          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <BookOpen className="w-4 h-4 text-foreground" />
              <span>知识库实体、文档清单及仓库绑定在知识库管理页维护</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/knowledge-bases')}
              className="gap-1.5 rounded-xl border-border text-xs cursor-pointer"
            >
              <Database className="w-3.5 h-3.5" />
              前往知识库管理
              <ArrowRight className="w-3 h-3 ml-0.5" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* RAG pipeline parameters */}
      <Card className="rounded-2xl border-border bg-card shadow-xs">
        <CardHeader className="pb-4">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-foreground" />
            <CardTitle className="text-base font-semibold">RAG 核心流水线算法参数</CardTitle>
          </div>
          <CardDescription>控制文档分块切割粒度和向量相似度召回过滤门槛</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Top-K 数量 (top_k)
                </Label>
                <span className="text-[11px] font-mono text-muted-foreground">默认: 5</span>
              </div>
              <Input
                type="number"
                min="1"
                placeholder="5"
                value={form.top_k ?? ''}
                onChange={set('top_k')}
                className="rounded-xl border-border bg-background"
              />
              <p className="text-[11px] text-muted-foreground leading-normal">
                单次检索向大模型注入的最大文档切片召回数。较高的值提供更丰富上下文，但消耗更多 Token。
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  最低相似度 (min_score)
                </Label>
                <span className="text-[11px] font-mono text-muted-foreground">范围: 0.0 ~ 1.0</span>
              </div>
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
              <p className="text-[11px] text-muted-foreground leading-normal">
                余弦相似度分数过滤门槛。低于该阈值的切片被丢弃，防止不相关噪音干扰模型决策。
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  分块大小 (chunk_size)
                </Label>
                <span className="text-[11px] font-mono text-muted-foreground">字符数 (建议 256~1024)</span>
              </div>
              <Input
                type="number"
                min="64"
                placeholder="512"
                value={form.chunk_size ?? ''}
                onChange={set('chunk_size')}
                className="rounded-xl border-border bg-background"
              />
              <p className="text-[11px] text-muted-foreground leading-normal">
                文档切分时每个分块的字符上限。较小分块召回精准，较大分块保留完整上下文。
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  分块重叠 (chunk_overlap)
                </Label>
                <span className="text-[11px] font-mono text-muted-foreground">字符数 (建议 30~100)</span>
              </div>
              <Input
                type="number"
                min="0"
                placeholder="50"
                value={form.chunk_overlap ?? ''}
                onChange={set('chunk_overlap')}
                className="rounded-xl border-border bg-background"
              />
              <p className="text-[11px] text-muted-foreground leading-normal">
                相邻分块重叠的字符数，防止关键句式或实体语义在分块边界被截断。
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Vault 笔记库增量同步与索引调度卡片 */}
      <Card className="rounded-2xl border-border bg-card shadow-xs">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-foreground" />
              <CardTitle className="text-base font-semibold">Vault 笔记库增量同步与索引调度</CardTitle>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleTriggerVaultSync}
              disabled={triggering}
              className="rounded-xl text-xs gap-1.5 cursor-pointer"
            >
              <RefreshCw className={`w-3 h-3 ${triggering ? 'animate-spin' : ''}`} />
              {triggering ? '正在扫描…' : '立即执行全量扫描'}
            </Button>
          </div>
          <CardDescription>
            自动定时扫描绑定的 Obsidian / 本地 Markdown 笔记或 WebDAV 目录，按 SHA-256 差异增量重建向量切片
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                自动增量同步周期（分钟）
              </Label>
              <Input
                type="number"
                min="1"
                placeholder="15"
                value={form.vault_sync_interval_minutes ?? ''}
                onChange={set('vault_sync_interval_minutes')}
                className="rounded-xl border-border bg-background font-mono text-sm max-w-xs"
              />
              <p className="text-[11px] text-muted-foreground">
                后台轮询定时器周期。每隔设定分钟数，系统会自动按序扫描所有启用了「自动同步」的仓库。
              </p>
            </div>

            <div className="p-3.5 rounded-xl border border-border bg-muted/20 space-y-2 text-xs">
              <div className="font-semibold text-foreground text-xs">后台调度状态</div>
              <div className="flex justify-between text-muted-foreground">
                <span>定时器状态:</span>
                <span className={schedulerStatus?.running ? 'text-emerald-600 font-medium' : 'text-muted-foreground'}>
                  {schedulerStatus?.running ? `运行中 (每 ${schedulerStatus.intervalMinutes} 分钟)` : '未启动'}
                </span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>已纳入定时轮询:</span>
                <span className="font-semibold text-foreground">{schedulerStatus?.autoSyncVaultCount ?? 0} 个仓库</span>
              </div>
              {schedulerStatus?.lastPollAt && (
                <div className="flex justify-between text-muted-foreground">
                  <span>最近一次扫描:</span>
                  <span className="font-mono text-foreground">
                    {new Date(schedulerStatus.lastPollAt).toLocaleString()}
                  </span>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
