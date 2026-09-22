import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Database, Sliders, Save, Check, ArrowRight, Sparkles, BookOpen } from 'lucide-react'
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
  const hasInitializedRef = useRef(false)

  useEffect(() => {
    if (settings && !hasInitializedRef.current) {
      hasInitializedRef.current = true
      setForm({
        top_k: settings.top_k ?? '5',
        min_score: settings.min_score ?? '0.5',
        chunk_size: settings.chunk_size ?? '512',
        chunk_overlap: settings.chunk_overlap ?? '50',
      })
    }
  }, [settings])

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [key]: e.target.value }))

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const payload: SettingsUpdate = {
        top_k: form.top_k ? Number(form.top_k) : undefined,
        min_score: form.min_score ? Number(form.min_score) : undefined,
        chunk_size: form.chunk_size ? Number(form.chunk_size) : undefined,
        chunk_overlap: form.chunk_overlap ? Number(form.chunk_overlap) : undefined,
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
          <h2 className="text-xl font-bold tracking-tight">知识检索专员设置 (KnowledgeAgent)</h2>
          <p className="text-sm text-muted-foreground mt-0.5">调优 RAG 核心分块与语义相似度召回流水线参数</p>
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

      {/* Specialist mechanism explanation card */}
      <Card className="rounded-2xl border-border bg-card shadow-xs">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-foreground" />
            <CardTitle className="text-base font-semibold">专员机制与委托协作</CardTitle>
          </div>
          <CardDescription>
            KnowledgeAgent 在 Multi-Agent 架构中作为专注于私有知识检索的专家专员工作
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-3.5 rounded-xl bg-secondary/50 border border-border/80 text-xs text-muted-foreground leading-relaxed space-y-2">
            <p>
              <strong className="text-foreground">委派工具机制 (<code>delegate_to_knowledge_agent</code>)：</strong>
              编排主智能体（Orchestrator）在识别到用户提问涉及私有文档、业务知识库或专业参考时，会通过函数调用将检索子任务移交至 <strong>KnowledgeAgent</strong>。
            </p>
            <p>
              专员结合语义分块切片算法与 Chroma 向量数据库进行余弦相似度召回，经过最低相似度过滤后提炼相关切片，再将高置信度事实上下文回传给主智能体进行融合推理。
            </p>
          </div>

          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <BookOpen className="w-4 h-4 text-foreground" />
              <span>知识库实体、文档管理及 Vault 仓库配置独立维护</span>
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
          <CardDescription>控制文档分块切割和向量相似度召回过滤逻辑</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Top-K 数量 (top_k)</Label>
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
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">最低相似度 (min_score)</Label>
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
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">分块大小 (chunk_size)</Label>
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
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">分块重叠 (chunk_overlap)</Label>
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
                相邻两个文本分块之间的重叠字符数。确保跨切片的语义句子不被生硬截断。
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
