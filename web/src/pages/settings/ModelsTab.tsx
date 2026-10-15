import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Save,
  Check,
  FlaskConical,
  Plus,
  Trash2,
  Layers,
  Sparkles,
  Brain,
  Pencil,
  Database,
  X,
  Cpu,
  Download,
  Search,
  CheckCircle2,
} from 'lucide-react'
import * as api from '@/api'
import type { Settings, SettingsUpdate, ProviderProtocol, ThinkingLevel } from '@/api'

type TestState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; msg: string }
  | { status: 'err'; msg: string }

type FetchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; msg: string; models: string[] }
  | { status: 'err'; msg: string }

interface ModelsTabProps {
  settings?: Settings
}

interface EditingProviderState {
  id: string
  name: string
  protocol: ProviderProtocol
  baseUrl: string
  apiKey: string
  models: string[]
}

export default function ModelsTab({ settings }: ModelsTabProps) {
  const qc = useQueryClient()
  const [form, setForm] = useState<Partial<Record<string, string>>>({})
  const [saved, setSaved] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  // LLM and Embedding tests
  const [chatTest, setChatTest] = useState<TestState>({ status: 'idle' })
  const [embedTest, setEmbedTest] = useState<TestState>({ status: 'idle' })

  // Multi-model providers list
  const { data: providers = [] } = useQuery({
    queryKey: ['providers'],
    queryFn: api.listProviders,
  })

  // Provider creation state
  const [isAddingProvider, setIsAddingProvider] = useState(false)
  const [newProvName, setNewProvName] = useState('')
  const [newProvProtocol, setNewProvProtocol] = useState<ProviderProtocol>('openai-completions')
  const [newProvBaseUrl, setNewProvBaseUrl] = useState('')
  const [newProvApiKey, setNewProvApiKey] = useState('')
  const [newProvModels, setNewProvModels] = useState<string[]>([])
  const [newProvCustomModel, setNewProvCustomModel] = useState('')
  const [newProvFetchState, setNewProvFetchState] = useState<FetchState>({ status: 'idle' })
  const [newProvSearch, setNewProvSearch] = useState('')

  // Provider edit modal state
  const [editingProvider, setEditingProvider] = useState<EditingProviderState | null>(null)
  const [editFetchState, setEditFetchState] = useState<FetchState>({ status: 'idle' })
  const [editSearch, setEditSearch] = useState('')
  const [editCustomModel, setEditCustomModel] = useState('')

  // Custom manual input toggle states
  const [customChatModel, setCustomChatModel] = useState(false)
  const [customEmbedModel, setCustomEmbedModel] = useState(false)

  useEffect(() => {
    if (settings) {
      setForm({
        default_provider: settings.default_provider || 'default',
        llm_model: settings.llm_model ?? '',
        default_thinking_level: settings.default_thinking_level || 'medium',
        embedding_provider: settings.embedding_provider || settings.default_provider || 'default',
        embedding_model: settings.embedding_model ?? '',
      })
    }
  }, [settings])

  const handleSaveAssignments = async () => {
    setIsSaving(true)
    try {
      const payload: SettingsUpdate = {
        default_provider: form.default_provider,
        llm_model: form.llm_model,
        default_thinking_level: form.default_thinking_level as ThinkingLevel,
        embedding_provider: form.embedding_provider,
        embedding_model: form.embedding_model,
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

  // Test Chat model connectivity
  const handleTestChat = async () => {
    setChatTest({ status: 'loading' })
    try {
      const res = await api.testChat({
        providerId: form.default_provider,
        modelId: form.llm_model,
      })
      if (res.ok) {
        setChatTest({
          status: 'ok',
          msg: `✓ 对话模型连接正常 (响应耗时: ${res.elapsed_ms}ms)`,
        })
      } else {
        setChatTest({ status: 'err', msg: `✗ 对话测试失败: ${res.detail || '服务未响应'}` })
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setChatTest({ status: 'err', msg: `✗ ${msg}` })
    }
  }

  // Test Embedding model connectivity
  const handleTestEmbedding = async () => {
    setEmbedTest({ status: 'loading' })
    try {
      const res = await api.testEmbedding({
        embedding_provider: form.embedding_provider,
        embedding_model: form.embedding_model,
      })
      if (res.ok) {
        setEmbedTest({
          status: 'ok',
          msg: `✓ 嵌入连通正常 (返回向量维度: ${res.dimensions}${res.elapsed_ms ? `，耗时: ${res.elapsed_ms}ms` : ''})`,
        })
      } else {
        setEmbedTest({ status: 'err', msg: `✗ 嵌入测试失败` })
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setEmbedTest({ status: 'err', msg: `✗ ${msg}` })
    }
  }

  // Fetch models for editing provider
  const handleFetchModelsForEditing = async () => {
    if (!editingProvider) return
    const baseUrl = editingProvider.baseUrl.trim()
    if (!baseUrl) {
      setEditFetchState({ status: 'err', msg: '请先填写 Base URL' })
      return
    }
    setEditFetchState({ status: 'loading' })
    try {
      const res = await api.fetchModels({
        providerId: editingProvider.id,
        baseUrl: editingProvider.baseUrl,
        apiKey: editingProvider.apiKey.trim() || undefined,
      })
      const list = res.models || []
      setEditFetchState({
        status: 'ok',
        msg: `成功获取到 ${list.length} 个远端模型`,
        models: list,
      })
    } catch (e: any) {
      setEditFetchState({ status: 'err', msg: `获取模型失败: ${e.message || e}` })
    }
  }

  // Fetch models for new provider
  const handleFetchModelsForNew = async () => {
    const baseUrl = newProvBaseUrl.trim()
    if (!baseUrl) {
      setNewProvFetchState({ status: 'err', msg: '请先填写 Base URL' })
      return
    }
    setNewProvFetchState({ status: 'loading' })
    try {
      const res = await api.fetchModels({
        baseUrl: newProvBaseUrl.trim(),
        apiKey: newProvApiKey.trim() || undefined,
      })
      const list = res.models || []
      setNewProvFetchState({
        status: 'ok',
        msg: `成功获取到 ${list.length} 个远端模型`,
        models: list,
      })
    } catch (e: any) {
      setNewProvFetchState({ status: 'err', msg: `获取模型失败: ${e.message || e}` })
    }
  }

  // Toggle model selection in editing modal
  const toggleEditModel = (modelId: string) => {
    if (!editingProvider) return
    const exists = editingProvider.models.includes(modelId)
    const nextModels = exists
      ? editingProvider.models.filter((m) => m !== modelId)
      : [...editingProvider.models, modelId]
    setEditingProvider({ ...editingProvider, models: nextModels })
  }

  // Add custom manual model in editing modal
  const handleAddEditCustomModel = () => {
    if (!editingProvider || !editCustomModel.trim()) return
    const m = editCustomModel.trim()
    if (!editingProvider.models.includes(m)) {
      setEditingProvider({ ...editingProvider, models: [...editingProvider.models, m] })
    }
    setEditCustomModel('')
  }

  // Toggle model selection in new provider form
  const toggleNewProvModel = (modelId: string) => {
    const exists = newProvModels.includes(modelId)
    if (exists) {
      setNewProvModels(newProvModels.filter((m) => m !== modelId))
    } else {
      setNewProvModels([...newProvModels, modelId])
    }
  }

  const handleAddNewProvCustomModel = () => {
    const m = newProvCustomModel.trim()
    if (!m) return
    if (!newProvModels.includes(m)) {
      setNewProvModels([...newProvModels, m])
    }
    setNewProvCustomModel('')
  }

  // Save new provider
  const handleAddProvider = async () => {
    if (!newProvName.trim() || !newProvBaseUrl.trim()) return
    const models = newProvModels.map((id) => ({ id, name: id, reasoning: true }))
    try {
      await api.createProvider({
        name: newProvName.trim(),
        protocol: newProvProtocol,
        baseUrl: newProvBaseUrl.trim(),
        apiKey: newProvApiKey.trim(),
        enabled: true,
        models,
      })
      setNewProvName('')
      setNewProvBaseUrl('')
      setNewProvApiKey('')
      setNewProvModels([])
      setNewProvFetchState({ status: 'idle' })
      setIsAddingProvider(false)
      qc.invalidateQueries({ queryKey: ['providers'] })
      qc.invalidateQueries({ queryKey: ['available-models'] })
    } catch (e: any) {
      alert(`添加厂商失败: ${e.message || e}`)
    }
  }

  // Save edited provider
  const handleSaveEditProvider = async () => {
    if (!editingProvider || !editingProvider.name.trim() || !editingProvider.baseUrl.trim()) return
    const models = editingProvider.models.map((id) => ({ id, name: id, reasoning: true }))

    try {
      await api.updateProvider(editingProvider.id, {
        name: editingProvider.name.trim(),
        protocol: editingProvider.protocol,
        baseUrl: editingProvider.baseUrl.trim(),
        apiKey: editingProvider.apiKey.trim() || undefined,
        models,
      })
      setEditingProvider(null)
      setEditFetchState({ status: 'idle' })
      qc.invalidateQueries({ queryKey: ['providers'] })
      qc.invalidateQueries({ queryKey: ['available-models'] })
    } catch (e: any) {
      alert(`保存厂商配置失败: ${e.message || e}`)
    }
  }

  const handleDeleteProvider = async (id: string) => {
    if (!confirm(`确认删除此模型厂商？已配置使用此厂商的模型可能会受到影响。`)) return
    try {
      await api.deleteProvider(id)
      qc.invalidateQueries({ queryKey: ['providers'] })
      qc.invalidateQueries({ queryKey: ['available-models'] })
    } catch (e: any) {
      alert(`删除厂商失败: ${e.message || e}`)
    }
  }

  const chatProvider = providers.find((p) => p.id === (form.default_provider || 'default')) || providers[0]
  const chatModels = chatProvider?.models || []

  const embedProvider =
    providers.find((p) => p.id === (form.embedding_provider || form.default_provider || 'default')) || providers[0]
  const embedModels = embedProvider?.models || []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">模型服务中心 (Model Hub)</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            配置模型服务商（厂商端点与密钥只配一次），在全局指派对话与知识库向量嵌入模型
          </p>
        </div>
        <Button
          onClick={handleSaveAssignments}
          disabled={isSaving}
          className="rounded-xl bg-foreground text-background hover:opacity-90 gap-2 shadow-xs cursor-pointer"
        >
          {saved ? <Check className="h-4 w-4 text-emerald-400" /> : <Save className="h-4 w-4" />}
          {isSaving ? '保存中…' : saved ? '已保存' : '保存'}
        </Button>
      </div>

      {/* 1. 上方：模型服务商与渠道管理 (Provider Hub) —— 先配厂商 */}
      <Card className="rounded-2xl border-border bg-card shadow-xs">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-foreground" />
              <CardTitle className="text-base font-semibold">模型服务商中心 (Providers)</CardTitle>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsAddingProvider(!isAddingProvider)}
              className="rounded-xl text-xs gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              新增服务商
            </Button>
          </div>
          <CardDescription>
            集中配置各 AI 厂商端点与访问密钥。点击「编辑」可自动拉取服务商模型并勾选录入
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 新增厂商内联表单 */}
          {isAddingProvider && (
            <div className="p-4 rounded-xl border border-dashed border-border/80 bg-accent/20 space-y-3.5">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Plus className="w-3.5 h-3.5" />
                  <span>添加新服务商渠道</span>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 rounded-lg text-muted-foreground"
                  onClick={() => setIsAddingProvider(false)}
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  placeholder="厂商名称 (如: Anthropic / DeepSeek / 硅基流动 / Ollama)"
                  value={newProvName}
                  onChange={(e) => setNewProvName(e.target.value)}
                  className="rounded-xl text-xs"
                />
                <select
                  value={newProvProtocol}
                  onChange={(e) => setNewProvProtocol(e.target.value as ProviderProtocol)}
                  className="rounded-xl border border-border bg-background px-3 py-2 text-xs"
                >
                  <option value="openai-completions">OpenAI Completions (/v1/chat/completions)</option>
                  <option value="openai-responses">OpenAI Responses (/v1/responses)</option>
                  <option value="anthropic-messages">Anthropic Messages (Claude 原生协议)</option>
                  <option value="google-generative-ai">Google Generative AI (Gemini 原生协议)</option>
                </select>
                <Input
                  placeholder="Base URL (如: https://api.deepseek.com 或 http://localhost:11434)"
                  value={newProvBaseUrl}
                  onChange={(e) => setNewProvBaseUrl(e.target.value)}
                  className="rounded-xl text-xs font-mono"
                />
                <PasswordInput
                  placeholder="API Key (密钥)"
                  value={newProvApiKey}
                  onChange={(e) => setNewProvApiKey(e.target.value)}
                  className="rounded-xl text-xs font-mono"
                />
              </div>

              {/* 自动获取模型与选择录入区 */}
              <div className="p-3 rounded-xl border border-border/80 bg-background/50 space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleFetchModelsForNew}
                      disabled={newProvFetchState.status === 'loading'}
                      className="rounded-xl h-7 px-2.5 text-xs gap-1.5 cursor-pointer"
                    >
                      <Download className="w-3 h-3" />
                      {newProvFetchState.status === 'loading' ? '拉取模型中…' : '从远端端点拉取可用模型'}
                    </Button>
                    {newProvFetchState.status === 'ok' && (
                      <span className="text-[11px] text-emerald-600 dark:text-emerald-400">
                        {newProvFetchState.msg}
                      </span>
                    )}
                    {newProvFetchState.status === 'err' && (
                      <span className="text-[11px] text-destructive">{newProvFetchState.msg}</span>
                    )}
                  </div>
                  <span className="text-[11px] text-muted-foreground">已选入 {newProvModels.length} 个模型</span>
                </div>

                {/* 候选模型选择池 */}
                {newProvFetchState.status === 'ok' && newProvFetchState.models.length > 0 && (
                  <div className="space-y-2 pt-1 border-t border-border/60">
                    <div className="flex items-center justify-between gap-2">
                      <div className="relative flex-1 max-w-xs">
                        <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-muted-foreground" />
                        <Input
                          placeholder="过滤远端模型…"
                          value={newProvSearch}
                          onChange={(e) => setNewProvSearch(e.target.value)}
                          className="rounded-xl pl-8 h-7 text-xs"
                        />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            const all = Array.from(new Set([...newProvModels, ...newProvFetchState.models]))
                            setNewProvModels(all)
                          }}
                          className="h-6 text-[11px] px-2"
                        >
                          全选添加
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setNewProvModels([])}
                          className="h-6 text-[11px] px-2 text-muted-foreground"
                        >
                          清空
                        </Button>
                      </div>
                    </div>

                    <div className="max-h-36 overflow-y-auto flex flex-wrap gap-1.5 p-2 rounded-lg bg-muted/30 border border-border/50">
                      {newProvFetchState.models
                        .filter((m) => m.toLowerCase().includes(newProvSearch.toLowerCase()))
                        .map((m) => {
                          const selected = newProvModels.includes(m)
                          return (
                            <button
                              key={m}
                              type="button"
                              onClick={() => toggleNewProvModel(m)}
                              className={`px-2 py-0.5 rounded-md font-mono text-[11px] transition-all flex items-center gap-1 cursor-pointer border ${
                                selected
                                  ? 'bg-primary text-primary-foreground border-primary font-medium shadow-2xs'
                                  : 'bg-background hover:bg-accent border-border text-muted-foreground hover:text-foreground'
                              }`}
                            >
                              {selected && <CheckCircle2 className="w-2.5 h-2.5" />}
                              <span>{m}</span>
                            </button>
                          )
                        })}
                    </div>
                  </div>
                )}

                {/* 手动追加与已选列表 */}
                <div className="flex gap-2 items-center pt-1">
                  <Input
                    placeholder="手动输入单个模型 ID (回车录入)"
                    value={newProvCustomModel}
                    onChange={(e) => setNewProvCustomModel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        handleAddNewProvCustomModel()
                      }
                    }}
                    className="rounded-xl text-xs font-mono h-7 flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleAddNewProvCustomModel}
                    className="rounded-xl text-xs h-7 px-2.5 shrink-0"
                  >
                    添加
                  </Button>
                </div>

                {newProvModels.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {newProvModels.map((m) => (
                      <span
                        key={m}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-secondary text-foreground font-mono text-[11px]"
                      >
                        <span>{m}</span>
                        <button
                          type="button"
                          onClick={() => toggleNewProvModel(m)}
                          className="hover:text-destructive cursor-pointer"
                        >
                          <X className="w-2.5 h-2.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsAddingProvider(false)}
                  className="rounded-xl text-xs"
                >
                  取消
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void handleAddProvider()}
                  disabled={!newProvName.trim() || !newProvBaseUrl.trim()}
                  className="rounded-xl gap-1 text-xs shrink-0 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  添加
                </Button>
              </div>
            </div>
          )}

          {/* 厂商列表卡片 */}
          <div className="space-y-2.5">
            {providers.map((p) => {
              const isDefaultChat = (form.default_provider || 'default') === p.id
              const isDefaultEmbed = (form.embedding_provider || form.default_provider || 'default') === p.id
              return (
                <div
                  key={p.id}
                  className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl border transition-all text-xs ${
                    isDefaultChat || isDefaultEmbed
                      ? 'border-primary/40 bg-accent/30 shadow-xs'
                      : 'border-border bg-card hover:border-foreground/20'
                  }`}
                >
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-foreground text-sm">{p.name}</span>
                      <span className="px-1.5 py-0.5 rounded bg-secondary text-muted-foreground font-mono text-[10px]">
                        {p.protocol}
                      </span>
                      {isDefaultChat && (
                        <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium text-[10px]">
                          默认对话
                        </span>
                      )}
                      {isDefaultEmbed && (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium text-[10px]">
                          默认嵌入
                        </span>
                      )}
                    </div>
                    <div className="text-muted-foreground font-mono truncate">{p.baseUrl}</div>
                    <div className="text-muted-foreground flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium text-foreground/80">已配模型 ({p.models.length}):</span>
                      {p.models.length > 0 ? (
                        p.models.map((m) => (
                          <span
                            key={m.id}
                            className="px-1.5 py-0.2 rounded bg-muted font-mono text-[11px] text-muted-foreground"
                          >
                            {m.id}
                          </span>
                        ))
                      ) : (
                        <span className="italic text-muted-foreground">暂未录入模型，可点击编辑自动拉取</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0 self-end sm:self-center">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setEditingProvider({
                          id: p.id,
                          name: p.name,
                          protocol: p.protocol,
                          baseUrl: p.baseUrl,
                          apiKey: '',
                          models: p.models.map((m) => m.id),
                        })
                        setEditFetchState({ status: 'idle' })
                        setEditSearch('')
                        setEditCustomModel('')
                      }}
                      className="rounded-xl h-8 px-2.5 text-xs gap-1 cursor-pointer"
                      title="编辑此厂商"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      编辑
                    </Button>
                    {p.id !== 'default' && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => void handleDeleteProvider(p.id)}
                        className="text-muted-foreground hover:text-destructive h-8 w-8 rounded-lg cursor-pointer"
                        title="删除厂商"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* 2. 下方：系统全局模型指派 (Global Model Assignments) —— 基于厂商选模型 */}
      <Card className="rounded-2xl border-border bg-card shadow-xs">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-foreground" />
            <CardTitle className="text-base font-semibold">系统全局模型指派</CardTitle>
          </div>
          <CardDescription>
            直接从上方已接入的服务商中，为智能体指定全局默认的对话生成模型与知识库 RAG 向量嵌入模型
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* 对话模型指派卡片 */}
            <div className="p-4 rounded-xl border border-border bg-muted/20 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <Sparkles className="w-3.5 h-3.5 text-primary" />
                  <span>AI 对话生成模型 (LLM)</span>
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  服务厂商 (Provider)
                </Label>
                <Select
                  value={form.default_provider || 'default'}
                  onValueChange={(val) => {
                    const p = providers.find((prov) => prov.id === val)
                    const nextModel = p?.models?.[0]?.id || ''
                    setForm((f) => ({
                      ...f,
                      default_provider: val,
                      llm_model: nextModel || f.llm_model,
                    }))
                    setChatTest({ status: 'idle' })
                  }}
                >
                  <SelectTrigger className="rounded-xl border-border bg-background text-xs h-9">
                    <SelectValue placeholder="选择服务厂商" />
                  </SelectTrigger>
                  <SelectContent>
                    {providers.map((p) => (
                      <SelectItem key={p.id} value={p.id} className="text-xs">
                        {p.name} ({p.protocol})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    对话模型 (Model ID)
                  </Label>
                  {chatModels.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setCustomChatModel(!customChatModel)}
                      className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 cursor-pointer"
                    >
                      {customChatModel ? (
                        <>
                          <CheckCircle2 className="w-2.5 h-2.5" />
                          <span>从厂商列表选</span>
                        </>
                      ) : (
                        <>
                          <Pencil className="w-2.5 h-2.5" />
                          <span>手动输入 ID</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    {!customChatModel && chatModels.length > 0 ? (
                      <Select
                        value={form.llm_model ?? ''}
                        onValueChange={(val) => {
                          setForm((f) => ({ ...f, llm_model: val }))
                          setChatTest({ status: 'idle' })
                        }}
                      >
                        <SelectTrigger className="rounded-xl border-border bg-background font-mono text-xs h-9">
                          <SelectValue placeholder="从该厂商选择对话模型" />
                        </SelectTrigger>
                        <SelectContent>
                          {chatModels.map((m) => (
                            <SelectItem key={m.id} value={m.id} className="font-mono text-xs">
                              {m.name || m.id}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        placeholder="输入模型 ID"
                        value={form.llm_model ?? ''}
                        onChange={(e) => {
                          setForm((f) => ({ ...f, llm_model: e.target.value }))
                          setChatTest({ status: 'idle' })
                        }}
                        className="rounded-xl border-border bg-background font-mono text-xs h-9"
                      />
                    )}
                  </div>
                  {/* LLM 对话模型测试按钮 */}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0 gap-1.5 rounded-xl border-border text-xs h-9 cursor-pointer"
                    disabled={chatTest.status === 'loading' || !form.llm_model}
                    onClick={handleTestChat}
                  >
                    <FlaskConical className="h-3.5 w-3.5" />
                    {chatTest.status === 'loading' ? '测试中…' : '测试'}
                  </Button>
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                  <Brain className="w-3 h-3" />
                  <span>默认思考深度 (Thinking)</span>
                </Label>
                <Select
                  value={form.default_thinking_level || 'medium'}
                  onValueChange={(val) => setForm((f) => ({ ...f, default_thinking_level: val }))}
                >
                  <SelectTrigger className="rounded-xl border-border bg-background text-xs h-9">
                    <SelectValue placeholder="思考深度" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="off" className="text-xs">
                      关闭思考 (Off)
                    </SelectItem>
                    <SelectItem value="low" className="text-xs">
                      快速思考 (Low)
                    </SelectItem>
                    <SelectItem value="medium" className="text-xs">
                      标准思考 (Medium - 推荐)
                    </SelectItem>
                    <SelectItem value="high" className="text-xs">
                      深度推理 (High)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="pt-0.5">
                {chatTest.status === 'ok' && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 break-all">{chatTest.msg}</p>
                )}
                {chatTest.status === 'err' && (
                  <p className="text-xs text-destructive break-all">{chatTest.msg}</p>
                )}
              </div>
            </div>

            {/* 向量嵌入模型指派卡片 */}
            <div className="p-4 rounded-xl border border-border bg-muted/20 space-y-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <Database className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>知识库向量嵌入模型 (Embedding)</span>
              </div>

              <div className="space-y-1">
                <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                  服务厂商 (Provider)
                </Label>
                <Select
                  value={form.embedding_provider || form.default_provider || 'default'}
                  onValueChange={(val) => {
                    const p = providers.find((prov) => prov.id === val)
                    const nextModel = p?.models?.[0]?.id || ''
                    setForm((f) => ({
                      ...f,
                      embedding_provider: val,
                      embedding_model: nextModel || f.embedding_model,
                    }))
                    setEmbedTest({ status: 'idle' })
                  }}
                >
                  <SelectTrigger className="rounded-xl border-border bg-background text-xs h-9">
                    <SelectValue placeholder="选择服务厂商" />
                  </SelectTrigger>
                  <SelectContent>
                    {providers.map((p) => (
                      <SelectItem key={p.id} value={p.id} className="text-xs">
                        {p.name} ({p.protocol})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    向量模型 (Model ID)
                  </Label>
                  {embedModels.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setCustomEmbedModel(!customEmbedModel)}
                      className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-1 cursor-pointer"
                    >
                      {customEmbedModel ? (
                        <>
                          <CheckCircle2 className="w-2.5 h-2.5" />
                          <span>从厂商列表选</span>
                        </>
                      ) : (
                        <>
                          <Pencil className="w-2.5 h-2.5" />
                          <span>手动输入 ID</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    {!customEmbedModel && embedModels.length > 0 ? (
                      <Select
                        value={form.embedding_model ?? ''}
                        onValueChange={(val) => {
                          setForm((f) => ({ ...f, embedding_model: val }))
                          setEmbedTest({ status: 'idle' })
                        }}
                      >
                        <SelectTrigger className="rounded-xl border-border bg-background font-mono text-xs h-9">
                          <SelectValue placeholder="从该厂商选择向量模型" />
                        </SelectTrigger>
                        <SelectContent>
                          {embedModels.map((m) => (
                            <SelectItem key={m.id} value={m.id} className="font-mono text-xs">
                              {m.name || m.id}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        placeholder="如: text-embedding-3-large 或 nomic-embed-text"
                        value={form.embedding_model ?? ''}
                        onChange={(e) => {
                          setForm((f) => ({ ...f, embedding_model: e.target.value }))
                          setEmbedTest({ status: 'idle' })
                        }}
                        className="rounded-xl border-border bg-background font-mono text-xs h-9"
                      />
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0 gap-1.5 rounded-xl border-border text-xs h-9 cursor-pointer"
                    disabled={embedTest.status === 'loading' || !form.embedding_model}
                    onClick={handleTestEmbedding}
                  >
                    <FlaskConical className="h-3.5 w-3.5" />
                    {embedTest.status === 'loading' ? '测试中…' : '测试'}
                  </Button>
                </div>
              </div>

              <div className="pt-1">
                {embedTest.status === 'ok' && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 break-all">{embedTest.msg}</p>
                )}
                {embedTest.status === 'err' && (
                  <p className="text-xs text-destructive break-all">{embedTest.msg}</p>
                )}
                {embedTest.status === 'idle' && (
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    专用于知识库切片向量化。可选用与对话同一厂商，亦可单独使用本地 Ollama 厂商零费用嵌入。
                  </p>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 厂商编辑模态框 (Modal) —— 支持自动获取模型并勾选录入 */}
      {editingProvider && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
          <div className="bg-card border border-border rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <div className="flex items-center gap-2">
                <Pencil className="w-4 h-4 text-primary" />
                <h3 className="font-semibold text-base">配置厂商与录入模型 - {editingProvider.name}</h3>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-lg text-muted-foreground cursor-pointer"
                onClick={() => setEditingProvider(null)}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            <div className="space-y-3.5 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    厂商名称
                  </Label>
                  <Input
                    value={editingProvider.name}
                    onChange={(e) => setEditingProvider({ ...editingProvider, name: e.target.value })}
                    className="rounded-xl text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    通信协议
                  </Label>
                  <select
                    value={editingProvider.protocol}
                    onChange={(e) =>
                      setEditingProvider({
                        ...editingProvider,
                        protocol: e.target.value as ProviderProtocol,
                      })
                    }
                    className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs"
                  >
                    <option value="openai-completions">OpenAI Completions (/v1/chat/completions)</option>
                    <option value="openai-responses">OpenAI Responses (/v1/responses)</option>
                    <option value="anthropic-messages">Anthropic Messages (Claude 原生协议)</option>
                    <option value="google-generative-ai">Google Generative AI (Gemini 原生协议)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Base URL (服务商端点)
                  </Label>
                  <Input
                    value={editingProvider.baseUrl}
                    onChange={(e) => setEditingProvider({ ...editingProvider, baseUrl: e.target.value })}
                    className="rounded-xl font-mono text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    API Key (留空表示保持现有密钥)
                  </Label>
                  <PasswordInput
                    placeholder="留空则保持现有密钥不变"
                    value={editingProvider.apiKey}
                    onChange={(e) => setEditingProvider({ ...editingProvider, apiKey: e.target.value })}
                    className="rounded-xl font-mono text-xs"
                  />
                </div>
              </div>

              {/* 核心：自动拉取模型并勾选录入 */}
              <div className="p-3.5 rounded-xl border border-border bg-muted/20 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleFetchModelsForEditing}
                      disabled={editFetchState.status === 'loading'}
                      className="rounded-xl h-7 px-2.5 text-xs gap-1.5 cursor-pointer"
                    >
                      <Download className="w-3 h-3" />
                      {editFetchState.status === 'loading' ? '正在拉取模型…' : '从该厂商自动获取可用模型'}
                    </Button>
                    {editFetchState.status === 'ok' && (
                      <span className="text-[11px] text-emerald-600 dark:text-emerald-400">
                        {editFetchState.msg}
                      </span>
                    )}
                    {editFetchState.status === 'err' && (
                      <span className="text-[11px] text-destructive">{editFetchState.msg}</span>
                    )}
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    已录入 <b>{editingProvider.models.length}</b> 个模型
                  </span>
                </div>

                {/* 候选模型选择池 */}
                {editFetchState.status === 'ok' && editFetchState.models.length > 0 && (
                  <div className="space-y-2 pt-1 border-t border-border">
                    <div className="flex items-center justify-between gap-2">
                      <div className="relative flex-1 max-w-xs">
                        <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-muted-foreground" />
                        <Input
                          placeholder="过滤远端拉取的模型…"
                          value={editSearch}
                          onChange={(e) => setEditSearch(e.target.value)}
                          className="rounded-xl pl-8 h-7 text-xs"
                        />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            const all = Array.from(new Set([...editingProvider.models, ...editFetchState.models]))
                            setEditingProvider({ ...editingProvider, models: all })
                          }}
                          className="h-6 text-[11px] px-2"
                        >
                          全部录入
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingProvider({ ...editingProvider, models: [] })}
                          className="h-6 text-[11px] px-2 text-muted-foreground"
                        >
                          清空
                        </Button>
                      </div>
                    </div>

                    <div className="max-h-40 overflow-y-auto flex flex-wrap gap-1.5 p-2 rounded-lg bg-background border border-border">
                      {editFetchState.models
                        .filter((m) => m.toLowerCase().includes(editSearch.toLowerCase()))
                        .map((m) => {
                          const selected = editingProvider.models.includes(m)
                          return (
                            <button
                              key={m}
                              type="button"
                              onClick={() => toggleEditModel(m)}
                              className={`px-2 py-0.5 rounded-md font-mono text-[11px] transition-all flex items-center gap-1 cursor-pointer border ${
                                selected
                                  ? 'bg-primary text-primary-foreground border-primary font-medium shadow-2xs'
                                  : 'bg-muted/40 hover:bg-accent border-border text-muted-foreground hover:text-foreground'
                              }`}
                            >
                              {selected && <CheckCircle2 className="w-2.5 h-2.5" />}
                              <span>{m}</span>
                            </button>
                          )
                        })}
                    </div>
                  </div>
                )}

                {/* 已录入模型列表（支持删除标签） */}
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      当前已录入的模型列表 (点击 ✕ 移除)
                    </Label>
                  </div>
                  {editingProvider.models.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto p-1.5 rounded-lg bg-background border border-border">
                      {editingProvider.models.map((m) => (
                        <span
                          key={m}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-secondary text-foreground font-mono text-[11px]"
                        >
                          <span>{m}</span>
                          <button
                            type="button"
                            onClick={() => toggleEditModel(m)}
                            className="hover:text-destructive cursor-pointer text-muted-foreground"
                          >
                            <X className="w-2.5 h-2.5" />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground italic">
                      当前暂未录入任何模型。请点击上方按钮拉取，或在下方手动录入。
                    </p>
                  )}
                </div>

                {/* 手动追加自定义模型 */}
                <div className="flex gap-2 items-center pt-1 border-t border-border/60">
                  <Input
                    placeholder="手动输入单个模型 ID 并回车添加 (如: gpt-4o 或 bge-m3)"
                    value={editCustomModel}
                    onChange={(e) => setEditCustomModel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        handleAddEditCustomModel()
                      }
                    }}
                    className="rounded-xl text-xs font-mono h-7 flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleAddEditCustomModel}
                    disabled={!editCustomModel.trim()}
                    className="rounded-xl text-xs h-7 px-2.5 shrink-0"
                  >
                    添加
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setEditingProvider(null)}
                className="rounded-xl text-xs cursor-pointer"
              >
                取消
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void handleSaveEditProvider()}
                className="rounded-xl text-xs cursor-pointer"
              >
                保存
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
