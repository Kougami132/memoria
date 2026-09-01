import { useEffect, useState } from 'react'
import {
  Activity,
  AlertCircle,
  Clock,
  Coins,
  FileCode,
  RefreshCw,
  ScrollText,
  Server,
  Trash2,
} from 'lucide-react'
import { logsApi, type InvocationLog } from '../api'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Badge } from '../components/ui/badge'

export default function Logs() {
  const [activeTab, setActiveTab] = useState<'invocation' | 'system'>('invocation')
  const [logs, setLogs] = useState<InvocationLog[]>([])
  const [loading, setLoading] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [systemLogsMessage, setSystemLogsMessage] = useState<string>('')

  const fetchInvocationLogs = async () => {
    setLoading(true)
    try {
      const res = await logsApi.listInvocations({ limit: 100, offset: 0 })
      setLogs(res.items || [])
    } catch (e) {
      console.error('Failed to load invocation logs:', e)
    } finally {
      setLoading(false)
    }
  }

  const fetchSystemLogs = async () => {
    setLoading(true)
    try {
      const res = await logsApi.getSystemLogs()
      setSystemLogsMessage(res.message || '系统日志模块预留中，暂未启用具体功能。')
    } catch (e) {
      console.error('Failed to load system logs:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (activeTab === 'invocation') {
      fetchInvocationLogs()
    } else {
      fetchSystemLogs()
    }
  }, [activeTab])

  const handleClearLogs = async () => {
    if (!window.confirm('确定要清空所有外部调用日志吗？')) return
    setClearing(true)
    try {
      await logsApi.clearInvocations()
      setLogs([])
    } catch (e) {
      console.error('Failed to clear invocation logs:', e)
    } finally {
      setClearing(false)
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

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-slate-950 p-6 overflow-hidden">
      {/* Header & Tabs */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400">
            <ScrollText className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">系统与调用日志</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              实时监控外部 API 调用耗时、Tokens 消耗及状态
            </p>
          </div>
        </div>

        {/* Tab Switcher & Actions */}
        <div className="flex items-center gap-3">
          <div className="flex p-1 bg-slate-200/70 dark:bg-slate-800 rounded-lg text-sm">
            <button
              onClick={() => setActiveTab('invocation')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md font-medium transition-all ${
                activeTab === 'invocation'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Activity className="w-4 h-4" />
              调用日志
            </button>
            <button
              onClick={() => setActiveTab('system')}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md font-medium transition-all ${
                activeTab === 'system'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <Server className="w-4 h-4" />
              系统日志
            </button>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={activeTab === 'invocation' ? fetchInvocationLogs : fetchSystemLogs}
            disabled={loading}
            className="flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>

          {activeTab === 'invocation' && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleClearLogs}
              disabled={clearing || logs.length === 0}
              className="flex items-center gap-1.5 text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/30"
            >
              <Trash2 className="w-3.5 h-3.5" />
              清空
            </Button>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-auto mt-4">
        {activeTab === 'invocation' ? (
          logs.length === 0 ? (
            <Card className="flex flex-col items-center justify-center p-12 text-center border-dashed border-slate-300 dark:border-slate-800">
              <FileCode className="w-12 h-12 text-slate-300 dark:text-slate-700 mb-3" />
              <h3 className="text-base font-medium text-slate-700 dark:text-slate-300">暂无外部调用日志</h3>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 max-w-sm">
                当外部客户端通过 /v1/chat/completions 或 /v1/responses 接口调用本系统时，相关请求耗时和 Token
                消耗将自动记录在此处。
              </p>
            </Card>
          ) : (
            <div className="border border-slate-200 dark:border-slate-800 rounded-lg bg-white dark:bg-slate-900 overflow-hidden shadow-sm">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 uppercase tracking-wider font-medium">
                  <tr>
                    <th className="py-3 px-4">请求时间</th>
                    <th className="py-3 px-4">接口路径</th>
                    <th className="py-3 px-4">模型 / Bot</th>
                    <th className="py-3 px-4">状态</th>
                    <th className="py-3 px-4">耗时 (ms)</th>
                    <th className="py-3 px-4">Prompt Tokens</th>
                    <th className="py-3 px-4">Completion Tokens</th>
                    <th className="py-3 px-4">总 Tokens</th>
                    <th className="py-3 px-4">关联会话</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-mono text-slate-700 dark:text-slate-300">
                  {logs.map((log) => {
                    const isSuccess = log.status_code >= 200 && log.status_code < 300
                    return (
                      <tr
                        key={log.id}
                        className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <td className="py-3 px-4 font-sans text-slate-500 dark:text-slate-400 whitespace-nowrap">
                          {formatTime(log.timestamp)}
                        </td>
                        <td className="py-3 px-4 font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap">
                          {log.endpoint}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <Badge variant="outline" className="font-mono text-[11px] font-normal">
                            {log.model}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          {isSuccess ? (
                            <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 border-0 font-sans">
                              {log.status_code} OK
                            </Badge>
                          ) : (
                            <span className="inline-flex items-center gap-1">
                              <Badge className="bg-rose-500/10 text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 border-0 font-sans">
                                {log.status_code}
                              </Badge>
                              {log.error_msg && (
                                <span
                                  className="text-rose-500 hover:text-rose-600 cursor-help"
                                  title={log.error_msg}
                                >
                                  <AlertCircle className="w-3.5 h-3.5" />
                                </span>
                              )}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span className="flex items-center gap-1 text-slate-600 dark:text-slate-300">
                            <Clock className="w-3 h-3 text-slate-400" />
                            {log.duration_ms}
                          </span>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap text-slate-600 dark:text-slate-400">
                          {log.prompt_tokens}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap text-slate-600 dark:text-slate-400">
                          {log.completion_tokens}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap font-medium text-indigo-600 dark:text-indigo-400">
                          <span className="flex items-center gap-1">
                            <Coins className="w-3 h-3 text-indigo-400" />
                            {log.total_tokens}
                          </span>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap font-sans text-slate-400">
                          {log.session_id ? (
                            <span className="text-[11px] font-mono bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-slate-600 dark:text-slate-400">
                              {log.session_id.length > 14
                                ? `${log.session_id.slice(0, 12)}...`
                                : log.session_id}
                            </span>
                          ) : (
                            <span className="text-slate-300 dark:text-slate-600">-</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <Card className="flex flex-col items-center justify-center p-16 text-center border-dashed border-slate-300 dark:border-slate-800">
            <div className="p-3 rounded-full bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 mb-3">
              <Server className="w-8 h-8" />
            </div>
            <h3 className="text-base font-medium text-slate-800 dark:text-slate-200">系统日志（预留功能）</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md">{systemLogsMessage}</p>
          </Card>
        )}
      </div>
    </div>
  )
}
