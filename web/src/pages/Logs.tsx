import React, { useEffect, useState, useMemo, useRef } from 'react'
import {
  Activity,
  AlertCircle,
  ArrowDown,
  Bot,
  ChevronDown,
  ChevronRight,
  Download,
  FileCode,
  Pause,
  Play,
  RefreshCw,
  Search,
  Server,
  Trash2,
} from 'lucide-react'
import {
  logsApi,
  type InvocationLog,
  type QQBotLog,
  type QQBotStats,
  type QQBotStatusResponse,
  type SystemLogItem,
} from '../api'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'

type TabKey = 'invocations' | 'qqbot' | 'system'

export default function Logs() {
  const [activeTab, setActiveTab] = useState<TabKey>('invocations')

  // Invocations state
  const [invocations, setInvocations] = useState<InvocationLog[]>([])
  const [invLoading, setInvLoading] = useState(false)
  const [invClearing, setInvClearing] = useState(false)
  const [selectedInvocation, setSelectedInvocation] = useState<InvocationLog | null>(null)

  // QQBot state
  const [qqbotStatus, setQqbotStatus] = useState<QQBotStatusResponse | null>(null)
  const [qqbotLogs, setQqbotLogs] = useState<QQBotLog[]>([])
  const [qqbotStats, setQqbotStats] = useState<QQBotStats | null>(null)
  const [qqbotLoading, setQqbotLoading] = useState(false)
  const [qqbotCategory, setQqbotCategory] = useState<string>('all')
  const [qqbotLevel, setQqbotLevel] = useState<string>('all')
  const [qqbotSearch, setQqbotSearch] = useState<string>('')
  const [expandedQqbotId, setExpandedQqbotId] = useState<string | null>(null)

  // System logs state
  const [systemLogs, setSystemLogs] = useState<SystemLogItem[]>([])
  const [systemLoading, setSystemLoading] = useState(false)
  const [systemLines, setSystemLines] = useState<number>(300)
  const [systemLevel, setSystemLevel] = useState<string>('ALL')
  const [systemSearch, setSystemSearch] = useState<string>('')
  const [systemFileSize, setSystemFileSize] = useState<number | undefined>(undefined)
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true)
  const terminalEndRef = useRef<HTMLDivElement | null>(null)
  const [stickToBottom, setStickToBottom] = useState<boolean>(true)

  // Initial fetch on tab change
  useEffect(() => {
    if (activeTab === 'invocations') {
      fetchInvocations()
    } else if (activeTab === 'qqbot') {
      fetchQQBotData()
    } else if (activeTab === 'system') {
      fetchSystemLogs()
    }
  }, [activeTab])

  // System logs auto-refresh interval (every 4s)
  useEffect(() => {
    if (activeTab !== 'system' || !autoRefresh) return
    const timer = setInterval(() => {
      fetchSystemLogs(true)
    }, 4000)
    return () => clearInterval(timer)
  }, [activeTab, autoRefresh, systemLines, systemLevel, systemSearch])

  // Auto scroll to bottom of terminal if stickToBottom is active
  useEffect(() => {
    if (activeTab === 'system' && stickToBottom && terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [systemLogs, activeTab, stickToBottom])

  const fetchInvocations = async () => {
    setInvLoading(true)
    try {
      const res = await logsApi.listInvocations({ limit: 100, offset: 0 })
      setInvocations(res.items || [])
    } catch (e) {
      console.error('Failed to load invocation logs:', e)
    } finally {
      setInvLoading(false)
    }
  }

  const handleClearInvocations = async () => {
    if (!window.confirm('确定要清空所有外部调用日志吗？')) return
    setInvClearing(true)
    try {
      await logsApi.clearInvocations()
      setInvocations([])
      setSelectedInvocation(null)
    } catch (e) {
      console.error('Failed to clear invocation logs:', e)
    } finally {
      setInvClearing(false)
    }
  }

  const fetchQQBotData = async () => {
    setQqbotLoading(true)
    try {
      const [statusRes, eventsRes] = await Promise.all([
        logsApi.getQQBotStatus().catch(() => null),
        logsApi.listQQBotEvents({
          category: qqbotCategory === 'all' ? undefined : qqbotCategory,
          level: qqbotLevel === 'all' ? undefined : qqbotLevel,
          limit: 200,
        }).catch(() => null),
      ])
      if (statusRes) setQqbotStatus(statusRes)
      if (eventsRes) {
        setQqbotLogs(eventsRes.items || [])
        setQqbotStats(eventsRes.stats)
      }
    } catch (e) {
      console.error('Failed to load QQBot logs:', e)
    } finally {
      setQqbotLoading(false)
    }
  }

  const handleClearQQBotLogs = async () => {
    if (!window.confirm('确定要清空 QQBot 审计日志吗？')) return
    try {
      await logsApi.clearQQBotEvents()
      fetchQQBotData()
    } catch (e) {
      console.error('Failed to clear QQBot events:', e)
    }
  }

  const fetchSystemLogs = async (silent = false) => {
    if (!silent) setSystemLoading(true)
    try {
      const res = await logsApi.getSystemLogs({
        lines: systemLines,
        level: systemLevel === 'ALL' ? undefined : systemLevel,
        search: systemSearch.trim() || undefined,
      })
      setSystemLogs(res.items || [])
      setSystemFileSize(res.file_size)
    } catch (e) {
      console.error('Failed to load system logs:', e)
    } finally {
      if (!silent) setSystemLoading(false)
    }
  }

  const formatTime = (iso: string) => {
    try {
      const d = new Date(iso)
      return d.toLocaleString('zh-CN', {
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    } catch {
      return iso
    }
  }

  const filteredQQBotLogs = useMemo(() => {
    if (!qqbotSearch.trim()) return qqbotLogs
    const q = qqbotSearch.toLowerCase()
    return qqbotLogs.filter(
      (l) =>
        (l.summary && l.summary.toLowerCase().includes(q)) ||
        (l.user_name && l.user_name.toLowerCase().includes(q)) ||
        (l.source_id && l.source_id.toLowerCase().includes(q)) ||
        (l.event_type && l.event_type.toLowerCase().includes(q)) ||
        (l.details && l.details.toLowerCase().includes(q))
    )
  }, [qqbotLogs, qqbotSearch])

  // Metric calculations
  const totalInvocationTokens = useMemo(
    () => invocations.reduce((acc, cur) => acc + (cur.total_tokens || 0), 0),
    [invocations]
  )
  const avgInvocationLatency = useMemo(() => {
    if (!invocations.length) return 0
    const sum = invocations.reduce((acc, cur) => acc + (cur.duration_ms || 0), 0)
    return Math.round(sum / invocations.length)
  }, [invocations])

  return (
    <div className="flex flex-col h-full bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 p-6 overflow-hidden">
      {/* Header section (OpenAI Dashboard style) */}
      <div className="flex flex-col md:flex-row md:items-center justify-between pb-5 border-b border-zinc-200 dark:border-zinc-800 gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              日志与监控 (Logs)
            </h1>
            <span className="text-[11px] font-mono uppercase px-1.5 py-0.5 rounded bg-zinc-200/70 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 font-medium">
              Observability
            </span>
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            统一纳管外部调用流、QQBot 网关交互及宿主系统运行日志
          </p>
        </div>

        {/* Segmented Control Pill Switcher */}
        <div className="flex items-center gap-3">
          <div className="inline-flex items-center p-0.5 rounded-lg bg-zinc-200/80 dark:bg-zinc-800/90 text-xs font-medium border border-zinc-200 dark:border-zinc-700/60 shadow-inner">
            <button
              onClick={() => setActiveTab('invocations')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all ${
                activeTab === 'invocations'
                  ? 'bg-white dark:bg-zinc-900 text-zinc-950 dark:text-zinc-50 shadow-sm font-semibold'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-100'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              调用日志
            </button>
            <button
              onClick={() => setActiveTab('qqbot')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all ${
                activeTab === 'qqbot'
                  ? 'bg-white dark:bg-zinc-900 text-zinc-950 dark:text-zinc-50 shadow-sm font-semibold'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-100'
              }`}
            >
              <Bot className="w-3.5 h-3.5" />
              QQBot 监控
            </button>
            <button
              onClick={() => setActiveTab('system')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all ${
                activeTab === 'system'
                  ? 'bg-white dark:bg-zinc-900 text-zinc-950 dark:text-zinc-50 shadow-sm font-semibold'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-100'
              }`}
            >
              <Server className="w-3.5 h-3.5" />
              系统日志
            </button>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (activeTab === 'invocations') fetchInvocations()
              else if (activeTab === 'qqbot') fetchQQBotData()
              else fetchSystemLogs()
            }}
            disabled={invLoading || qqbotLoading || systemLoading}
            className="h-8 px-2.5 text-xs border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 mr-1.5 ${
                invLoading || qqbotLoading || systemLoading ? 'animate-spin' : ''
              }`}
            />
            刷新
          </Button>
        </div>
      </div>

      {/* Metric summary strip (OpenAI minimal cards) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 py-4">
        <div className="p-3 bg-white dark:bg-zinc-900/90 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-sm">
          <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            {activeTab === 'invocations' ? '调用总次数' : activeTab === 'qqbot' ? 'QQBot 消息总数' : '当前载入行数'}
          </div>
          <div className="mt-1 text-xl font-mono font-semibold text-zinc-900 dark:text-zinc-100">
            {activeTab === 'invocations'
              ? invocations.length
              : activeTab === 'qqbot'
              ? qqbotStats?.message_count ?? qqbotLogs.filter((l) => l.category === 'message').length
              : systemLogs.length}
          </div>
        </div>

        <div className="p-3 bg-white dark:bg-zinc-900/90 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-sm">
          <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            {activeTab === 'invocations' ? '总 Tokens 消耗' : activeTab === 'qqbot' ? '网关事件数' : '文件大小'}
          </div>
          <div className="mt-1 text-xl font-mono font-semibold text-zinc-900 dark:text-zinc-100">
            {activeTab === 'invocations'
              ? totalInvocationTokens.toLocaleString()
              : activeTab === 'qqbot'
              ? qqbotStats?.total_events ?? qqbotLogs.length
              : systemFileSize
              ? `${(systemFileSize / 1024).toFixed(1)} KB`
              : '活跃'}
          </div>
        </div>

        <div className="p-3 bg-white dark:bg-zinc-900/90 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-sm">
          <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            {activeTab === 'invocations' ? '平均响应延时' : activeTab === 'qqbot' ? '异常记录数' : '日志等级过滤'}
          </div>
          <div className="mt-1 text-xl font-mono font-semibold text-zinc-900 dark:text-zinc-100">
            {activeTab === 'invocations'
              ? `${avgInvocationLatency} ms`
              : activeTab === 'qqbot'
              ? qqbotStats?.error_count ?? qqbotLogs.filter((l) => l.level === 'ERROR').length
              : systemLevel}
          </div>
        </div>

        <div className="p-3 bg-white dark:bg-zinc-900/90 border border-zinc-200 dark:border-zinc-800 rounded-lg shadow-sm flex flex-col justify-between">
          <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            {activeTab === 'invocations' ? '健康状态' : activeTab === 'qqbot' ? '网关连通状态' : '实时监听'}
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-sm font-medium">
            {activeTab === 'invocations' ? (
              <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-mono text-xs">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                200 OK 正常
              </span>
            ) : activeTab === 'qqbot' ? (
              <span
                className={`flex items-center gap-1.5 font-mono text-xs ${
                  qqbotStatus?.status === 'CONNECTED'
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : qqbotStatus?.status === 'CONNECTING'
                    ? 'text-amber-500 dark:text-amber-400'
                    : 'text-zinc-500 dark:text-zinc-400'
                }`}
              >
                {qqbotStatus?.status === 'CONNECTED' ? (
                  <>
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    已连接 (Connected)
                  </>
                ) : qqbotStatus?.status === 'CONNECTING' ? (
                  <>
                    <span className="h-2 w-2 rounded-full bg-amber-500 animate-ping" />
                    连接中...
                  </>
                ) : (
                  <>
                    <span className="h-2 w-2 rounded-full bg-zinc-400" />
                    {qqbotStatus?.status || '离线 / 未启动'}
                  </>
                )}
              </span>
            ) : (
              <span className="flex items-center gap-1.5 font-mono text-xs text-zinc-700 dark:text-zinc-300">
                <span
                  className={`h-2 w-2 rounded-full ${
                    autoRefresh ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-400'
                  }`}
                />
                {autoRefresh ? '4s 轮询监听' : '已暂停自动刷新'}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Main Content Panels */}
      <div className="flex-1 overflow-hidden min-h-0 flex flex-col mt-2">
        {/* TAB 1: INVOCATIONS */}
        {activeTab === 'invocations' && (
          <div className="flex flex-col h-full overflow-hidden">
            <div className="flex items-center justify-between pb-3">
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                共 <span className="font-mono text-zinc-900 dark:text-zinc-100 font-semibold">{invocations.length}</span> 条外部 API 交互记录
              </div>
              {invocations.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearInvocations}
                  disabled={invClearing}
                  className="h-7 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1" />
                  清空调用记录
                </Button>
              )}
            </div>

            <div className="flex-1 overflow-auto border border-zinc-200 dark:border-zinc-800 rounded-lg bg-white dark:bg-zinc-900 shadow-sm">
              {invocations.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-16 text-center text-zinc-400">
                  <FileCode className="w-10 h-10 mb-2 opacity-50 stroke-[1.5]" />
                  <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300">暂无外部调用日志</div>
                  <p className="text-xs mt-1 max-w-sm text-zinc-500">
                    当客户端调用 /v1/chat/completions 或 /v1/responses 时，相关耗时与 Tokens 将实时记录。
                  </p>
                </div>
              ) : (
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-800/90 border-b border-zinc-200 dark:border-zinc-800 text-zinc-500 uppercase font-mono text-[11px] tracking-wider z-10">
                    <tr>
                      <th className="py-2.5 px-3">请求时间</th>
                      <th className="py-2.5 px-3">接口</th>
                      <th className="py-2.5 px-3">模型</th>
                      <th className="py-2.5 px-3">状态</th>
                      <th className="py-2.5 px-3">耗时</th>
                      <th className="py-2.5 px-3">Tokens (P / C / Tot)</th>
                      <th className="py-2.5 px-3">会话 Session</th>
                      <th className="py-2.5 px-3 text-right">详情</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60 font-mono text-zinc-700 dark:text-zinc-300">
                    {invocations.map((log) => {
                      const isSuccess = log.status_code >= 200 && log.status_code < 300
                      return (
                        <tr
                          key={log.id}
                          onClick={() => setSelectedInvocation(selectedInvocation?.id === log.id ? null : log)}
                          className="hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40 cursor-pointer transition-colors"
                        >
                          <td className="py-2.5 px-3 font-sans text-zinc-500 whitespace-nowrap">
                            {formatTime(log.timestamp)}
                          </td>
                          <td className="py-2.5 px-3 font-semibold text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
                            {log.endpoint}
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <span className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-[11px] text-zinc-700 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700/60">
                              {log.model}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            {isSuccess ? (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-mono bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/40">
                                {log.status_code} OK
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-mono bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400 border border-rose-200 dark:border-rose-800/40">
                                <AlertCircle className="w-3 h-3" />
                                {log.status_code}
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap text-zinc-600 dark:text-zinc-400">
                            {log.duration_ms} ms
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap">
                            <span className="text-zinc-500">{log.prompt_tokens}</span>
                            <span className="text-zinc-400 mx-1">/</span>
                            <span className="text-zinc-500">{log.completion_tokens}</span>
                            <span className="text-zinc-400 mx-1">/</span>
                            <span className="font-semibold text-zinc-900 dark:text-zinc-100">{log.total_tokens}</span>
                          </td>
                          <td className="py-2.5 px-3 whitespace-nowrap text-zinc-500 font-sans text-[11px]">
                            {log.session_id ? log.session_id.slice(0, 16) : '-'}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            {selectedInvocation?.id === log.id ? (
                              <ChevronDown className="w-4 h-4 inline-block text-zinc-400" />
                            ) : (
                              <ChevronRight className="w-4 h-4 inline-block text-zinc-400" />
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Invocation JSON preview drawer */}
            {selectedInvocation && (
              <div className="mt-3 p-3 bg-zinc-900 text-zinc-100 rounded-lg border border-zinc-800 text-xs font-mono max-h-48 overflow-auto">
                <div className="flex items-center justify-between pb-1 border-b border-zinc-800 mb-2">
                  <span className="text-zinc-400">Invocation Details: {selectedInvocation.id}</span>
                  <button
                    onClick={() => setSelectedInvocation(null)}
                    className="text-zinc-400 hover:text-zinc-200"
                  >
                    关闭
                  </button>
                </div>
                <pre className="text-[11px] whitespace-pre-wrap leading-relaxed">
                  {JSON.stringify(selectedInvocation, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: QQBOT LOGS */}
        {activeTab === 'qqbot' && (
          <div className="flex flex-col h-full overflow-hidden">
            {/* QQBot Filters bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
              <div className="flex items-center gap-2">
                {/* Category selector */}
                <div className="inline-flex rounded-md bg-zinc-200/80 dark:bg-zinc-800 p-0.5 text-xs">
                  {(['all', 'message', 'connection'] as const).map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setQqbotCategory(cat)}
                      className={`px-2.5 py-1 rounded transition-colors ${
                        qqbotCategory === cat
                          ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 font-medium shadow-sm'
                          : 'text-zinc-600 dark:text-zinc-400'
                      }`}
                    >
                      {cat === 'all' ? '全部类别' : cat === 'message' ? '消息收发' : '网关连接'}
                    </button>
                  ))}
                </div>

                {/* Level selector */}
                <select
                  value={qqbotLevel}
                  onChange={(e) => setQqbotLevel(e.target.value)}
                  className="h-7 text-xs rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 text-zinc-700 dark:text-zinc-300"
                >
                  <option value="all">全部级别</option>
                  <option value="INFO">INFO</option>
                  <option value="WARN">WARN</option>
                  <option value="ERROR">ERROR</option>
                </select>

                {/* Search query */}
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2 top-2 text-zinc-400" />
                  <Input
                    type="text"
                    placeholder="搜索消息/用户/群号..."
                    value={qqbotSearch}
                    onChange={(e) => setQqbotSearch(e.target.value)}
                    className="h-7 pl-7 text-xs w-48 bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearQQBotLogs}
                  className="h-7 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1" />
                  清空 QQBot 日志
                </Button>
              </div>
            </div>

            {/* QQBot Logs Table */}
            <div className="flex-1 overflow-auto border border-zinc-200 dark:border-zinc-800 rounded-lg bg-white dark:bg-zinc-900 shadow-sm">
              {filteredQQBotLogs.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-16 text-center text-zinc-400">
                  <Bot className="w-10 h-10 mb-2 opacity-50 stroke-[1.5]" />
                  <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300">暂无 QQBot 审计流水</div>
                  <p className="text-xs mt-1 max-w-sm text-zinc-500">
                    当配置并启动 QQBot 后，所有 WebSocket 网关连接、群消息、私聊消息与 AI 回复流水将汇聚于此。
                  </p>
                </div>
              ) : (
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-800/90 border-b border-zinc-200 dark:border-zinc-800 text-zinc-500 uppercase font-mono text-[11px] tracking-wider z-10">
                    <tr>
                      <th className="py-2.5 px-3">时间</th>
                      <th className="py-2.5 px-3">类别</th>
                      <th className="py-2.5 px-3">级别</th>
                      <th className="py-2.5 px-3">事件类型</th>
                      <th className="py-2.5 px-3">来源 / 发送者</th>
                      <th className="py-2.5 px-3">摘要 / 详情</th>
                      <th className="py-2.5 px-3">处理耗时</th>
                      <th className="py-2.5 px-3 text-right">展开</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60 font-mono text-zinc-700 dark:text-zinc-300">
                    {filteredQQBotLogs.map((log) => {
                      const isError = log.level === 'ERROR'
                      const isWarn = log.level === 'WARN'
                      const isExpanded = expandedQqbotId === log.id
                      return (
                        <React.Fragment key={log.id}>
                          <tr
                            onClick={() => setExpandedQqbotId(isExpanded ? null : log.id)}
                            className="hover:bg-zinc-50/80 dark:hover:bg-zinc-800/40 cursor-pointer transition-colors"
                          >
                            <td className="py-2 px-3 font-sans text-zinc-500 whitespace-nowrap">
                              {formatTime(log.timestamp)}
                            </td>
                            <td className="py-2 px-3 whitespace-nowrap">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-sans uppercase font-medium ${
                                  log.category === 'connection'
                                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border border-blue-200 dark:border-blue-900/50'
                                    : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700/60'
                                }`}
                              >
                                {log.category === 'connection' ? 'Gateway' : 'Message'}
                              </span>
                            </td>
                            <td className="py-2 px-3 whitespace-nowrap">
                              <span
                                className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  isError
                                    ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                                    : isWarn
                                    ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                                    : 'text-zinc-500 dark:text-zinc-400'
                                }`}
                              >
                                {log.level}
                              </span>
                            </td>
                            <td className="py-2 px-3 font-semibold text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
                              {log.event_type}
                            </td>
                            <td className="py-2 px-3 whitespace-nowrap text-zinc-600 dark:text-zinc-400">
                              {log.source_type ? (
                                <span className="font-sans">
                                  {log.source_type === 'group' ? '群 ' : '私聊 '}
                                  <span className="font-mono text-zinc-800 dark:text-zinc-200">
                                    {log.source_id || '-'}
                                  </span>
                                  {log.user_name ? ` (${log.user_name})` : ''}
                                </span>
                              ) : (
                                <span className="text-zinc-400">-</span>
                              )}
                            </td>
                            <td className="py-2 px-3 text-zinc-800 dark:text-zinc-200 max-w-md truncate font-sans">
                              {log.summary}
                            </td>
                            <td className="py-2 px-3 whitespace-nowrap text-zinc-500">
                              {log.duration_ms > 0 ? `${log.duration_ms} ms` : '-'}
                            </td>
                            <td className="py-2 px-3 text-right">
                              {isExpanded ? (
                                <ChevronDown className="w-3.5 h-3.5 inline-block text-zinc-400" />
                              ) : (
                                <ChevronRight className="w-3.5 h-3.5 inline-block text-zinc-400" />
                              )}
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr className="bg-zinc-50 dark:bg-zinc-950/70">
                              <td colSpan={8} className="p-3 border-y border-zinc-200 dark:border-zinc-800">
                                <div className="space-y-1.5 text-[11px] font-mono">
                                  <div className="flex items-center gap-2 text-zinc-500">
                                    <span>事件 ID: {log.id}</span>
                                    <span>•</span>
                                    <span>完整摘要: {log.summary}</span>
                                  </div>
                                  {log.details && (
                                    <pre className="p-2 bg-zinc-900 text-zinc-200 rounded border border-zinc-800 whitespace-pre-wrap overflow-auto max-h-40">
                                      {log.details}
                                    </pre>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: SYSTEM CONSOLE LOGS */}
        {activeTab === 'system' && (
          <div className="flex flex-col h-full overflow-hidden">
            {/* Toolbar for terminal console */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
              <div className="flex items-center gap-2 flex-wrap">
                {/* Lines filter */}
                <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                  <span>显示行数:</span>
                  <select
                    value={systemLines}
                    onChange={(e) => setSystemLines(Number(e.target.value))}
                    className="h-7 text-xs rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 text-zinc-700 dark:text-zinc-300"
                  >
                    <option value={100}>100 行</option>
                    <option value={300}>300 行</option>
                    <option value={500}>500 行</option>
                    <option value={1000}>1000 行</option>
                  </select>
                </div>

                {/* Level filter */}
                <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                  <span>日志级别:</span>
                  <select
                    value={systemLevel}
                    onChange={(e) => setSystemLevel(e.target.value)}
                    className="h-7 text-xs rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 text-zinc-700 dark:text-zinc-300"
                  >
                    <option value="ALL">全部 (ALL)</option>
                    <option value="INFO">INFO</option>
                    <option value="WARNING">WARNING</option>
                    <option value="ERROR">ERROR</option>
                  </select>
                </div>

                {/* Search */}
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2 top-2 text-zinc-400" />
                  <Input
                    type="text"
                    placeholder="过滤关键字..."
                    value={systemSearch}
                    onChange={(e) => setSystemSearch(e.target.value)}
                    className="h-7 pl-7 text-xs w-44 bg-white dark:bg-zinc-900 border-zinc-300 dark:border-zinc-700"
                  />
                </div>
              </div>

              {/* Console control actions */}
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAutoRefresh(!autoRefresh)}
                  className={`h-7 text-xs border-zinc-300 dark:border-zinc-700 ${
                    autoRefresh
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800'
                      : 'text-zinc-600 dark:text-zinc-400'
                  }`}
                >
                  {autoRefresh ? (
                    <>
                      <Pause className="w-3 h-3 mr-1" />
                      自动刷新中
                    </>
                  ) : (
                    <>
                      <Play className="w-3 h-3 mr-1" />
                      已暂停
                    </>
                  )}
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setStickToBottom(!stickToBottom)}
                  className={`h-7 text-xs border-zinc-300 dark:border-zinc-700 ${
                    stickToBottom ? 'text-indigo-600 dark:text-indigo-400 font-medium' : 'text-zinc-500'
                  }`}
                  title="锁定滚动到最新日志"
                >
                  <ArrowDown className="w-3 h-3 mr-1" />
                  锁定底部
                </Button>

                <a
                  href={logsApi.getSystemLogDownloadUrl()}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center h-7 px-2.5 text-xs rounded border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                >
                  <Download className="w-3 h-3 mr-1" />
                  下载完整日志
                </a>
              </div>
            </div>

            {/* Embedded Terminal Console */}
            <div className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg p-3 font-mono text-[11px] overflow-auto shadow-inner text-zinc-300 flex flex-col justify-between">
              <div className="space-y-1 overflow-auto flex-1 pr-1 select-text">
                {systemLogs.length === 0 ? (
                  <div className="text-zinc-500 py-12 text-center">
                    {systemLoading ? '正在拉取系统日志...' : '暂无匹配的系统运行日志'}
                  </div>
                ) : (
                  systemLogs.map((item, idx) => {
                    const isError = item.level === 'ERROR'
                    const isWarn = item.level === 'WARNING' || item.level === 'WARN'
                    return (
                      <div
                        key={idx}
                        className="flex items-start gap-2 hover:bg-zinc-900/80 px-1.5 py-0.5 rounded transition-colors leading-relaxed"
                      >
                        <span className="text-zinc-600 select-none whitespace-nowrap text-[10px]">
                          {String(idx + 1).padStart(3, '0')}
                        </span>
                        <span className="text-zinc-500 whitespace-nowrap">
                          {item.timestamp ? `[${item.timestamp}]` : ''}
                        </span>
                        <span
                          className={`font-bold whitespace-nowrap px-1 rounded text-[10px] ${
                            isError
                              ? 'bg-rose-950/80 text-rose-400 border border-rose-900'
                              : isWarn
                              ? 'bg-amber-950/80 text-amber-400 border border-amber-900'
                              : 'bg-zinc-900 text-zinc-400'
                          }`}
                        >
                          {item.level || 'INFO'}
                        </span>
                        {item.component && (
                          <span className="text-zinc-400 whitespace-nowrap">
                            [{item.component}]
                          </span>
                        )}
                        <span
                          className={`flex-1 break-all ${
                            isError
                              ? 'text-rose-200'
                              : isWarn
                              ? 'text-amber-200'
                              : 'text-zinc-300'
                          }`}
                        >
                          {item.message || item.raw}
                        </span>
                      </div>
                    )
                  })
                )}
                <div ref={terminalEndRef} />
              </div>

              {/* Terminal Footer Bar */}
              <div className="pt-2 mt-2 border-t border-zinc-800 flex items-center justify-between text-[10px] text-zinc-500">
                <div>
                  Target: <span className="text-zinc-400">data/memoria.log</span>
                </div>
                <div className="flex items-center gap-3">
                  <span>已渲染 {systemLogs.length} 条</span>
                  <span>•</span>
                  <span>按 UTF-8 编码实时读取</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
