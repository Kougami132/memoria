import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Sparkles,
  Database,
  Server,
  Terminal,
  Cpu,
  ShieldCheck,
  Radio,
  HardDrive,
  GitBranch,
  Layers,
  ArrowRight
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import * as api from '@/api'

export default function About() {
  const navigate = useNavigate()

  const { data: health, isLoading } = useQuery({
    queryKey: ['system-health'],
    queryFn: api.getHealth,
    staleTime: 30000,
  })

  const version = health?.version ? `v${health.version}` : 'v2.0.0'
  const isHealthy = health?.status === 'ok'

  return (
    <div className="p-8 w-[920px] max-w-full mx-auto space-y-8">
      {/* Brand Hero */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-6 border-b border-border">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-foreground text-background flex items-center justify-center shadow-md">
              <Sparkles className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-2xl font-bold tracking-tight">Memoria</h1>
                <Badge variant="outline" className="font-mono text-xs px-2 py-0.5 border-border">
                  {version}
                </Badge>
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span>{isLoading ? '连接中…' : isHealthy ? '系统运行中' : '状态异常'}</span>
                </div>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                本地优先个人外脑与受控运维 AI Agent 平台
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('/agentic-chat')}
            className="rounded-xl border-border gap-1.5 text-xs cursor-pointer"
          >
            <span>进入 AI Agent</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('/settings')}
            className="rounded-xl border-border gap-1.5 text-xs cursor-pointer"
          >
            <span>系统设置</span>
          </Button>
        </div>
      </div>

      {/* Core Capabilities */}
      <div className="space-y-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight">核心能力与架构特性</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            构建兼具私有知识深度思考与安全服务器诊断执行的一体化智能体
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="rounded-2xl border-border bg-card shadow-xs">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2 text-primary">
                <Database className="w-4 h-4" />
                <CardTitle className="text-sm font-semibold">单文件 SQLite 混合检索 RAG</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground leading-relaxed space-y-1.5">
              <p>
                集成 <strong className="text-foreground">Float32Array 向量余弦相似度</strong> 与 <strong className="text-foreground">SQLite FTS5 BM25 全文分词</strong>，通过倒数排名融合（RRF）算法召回最相关上下文。
              </p>
              <p>
                支持本地文件夹与 WebDAV 远程仓库（Vault）的 SHA-256 增量感知与自动索引同步。
              </p>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-border bg-card shadow-xs">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2 text-primary">
                <Cpu className="w-4 h-4" />
                <CardTitle className="text-sm font-semibold">持久化状态机引擎 (pi-durable)</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground leading-relaxed space-y-1.5">
              <p>
                基于状态机 Harness 驱动会话生成与工具调用。所有事件事务性持久化，断线或页面刷新实现无缝增量恢复。
              </p>
              <p>
                支持运行中实时插话纠偏（<code>steer</code>）、排队追问（<code>followUp</code>）及任务独占的隔离子智能体（Subagent）。
              </p>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-border bg-card shadow-xs">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2 text-primary">
                <Server className="w-4 h-4" />
                <CardTitle className="text-sm font-semibold">受控主机运维与安全审批</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground leading-relaxed space-y-1.5">
              <p>
                基于 SSH 连接池与 HTTP CONNECT / SOCKS5 出口隧道穿透私网主机，执行日志审查与系统命令。
              </p>
              <p>
                内置 <strong className="text-foreground">CommandGuard</strong> 三级安全模式，高危与未知写入命令触发持久化审批挂起流，经人工确认后方可执行。
              </p>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-border bg-card shadow-xs">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2 text-primary">
                <Radio className="w-4 h-4" />
                <CardTitle className="text-sm font-semibold">多通道双向统一接入</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground leading-relaxed space-y-1.5">
              <p>
                支持现代化 React SPA Web 控制台，以及基于腾讯官方 WebSocket 开放平台的 QQ 机器人。
              </p>
              <p>
                提供标准 OpenAI 兼容接口（<code>/v1/chat/completions</code>），无缝对接任何第三方客户端与生态工具。
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Technical Specifications */}
      <Card className="rounded-2xl border-border bg-card shadow-xs">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-foreground" />
            <CardTitle className="text-sm font-semibold">系统规格与环境信息</CardTitle>
          </div>
          <CardDescription className="text-xs">
            零外部重型服务依赖，单可执行进程与单数据库自闭环架构
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div className="flex items-center justify-between p-3 rounded-xl bg-secondary/50 border border-border/60">
              <div className="flex items-center gap-2 text-muted-foreground">
                <HardDrive className="w-4 h-4 text-foreground shrink-0" />
                <span>持久化单文件存储</span>
              </div>
              <span className="font-mono font-medium text-foreground">node:sqlite (WAL 模式)</span>
            </div>

            <div className="flex items-center justify-between p-3 rounded-xl bg-secondary/50 border border-border/60">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Layers className="w-4 h-4 text-foreground shrink-0" />
                <span>智能体内核</span>
              </div>
              <span className="font-mono font-medium text-foreground">@earendil-works/pi-durable</span>
            </div>

            <div className="flex items-center justify-between p-3 rounded-xl bg-secondary/50 border border-border/60">
              <div className="flex items-center gap-2 text-muted-foreground">
                <GitBranch className="w-4 h-4 text-foreground shrink-0" />
                <span>会话动态作用域</span>
              </div>
              <span className="font-mono font-medium text-foreground">memoria.scope 隔离</span>
            </div>

            <div className="flex items-center justify-between p-3 rounded-xl bg-secondary/50 border border-border/60">
              <div className="flex items-center gap-2 text-muted-foreground">
                <ShieldCheck className="w-4 h-4 text-foreground shrink-0" />
                <span>主机安全控制</span>
              </div>
              <span className="font-mono font-medium text-foreground">CommandGuard 审批流</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
