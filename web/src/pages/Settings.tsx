import { useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Sliders, Database, Server, Globe, Radio, Cpu } from 'lucide-react'
import * as api from '@/api'
import GeneralSettingsTab from './settings/GeneralSettingsTab'
import ModelsTab from './settings/ModelsTab'
import KnowledgeAgentTab from './settings/KnowledgeAgentTab'
import HostAgentTab from './settings/HostAgentTab'
import WebAgentTab from './settings/WebAgentTab'
import QQBotTab from './settings/QQBotTab'

const VALID_TABS = ['general', 'models', 'knowledge-agent', 'host-agent', 'web-agent', 'qq-bot'] as const
type TabKey = typeof VALID_TABS[number]

interface TabItem {
  id: TabKey
  label: string
  icon: React.ComponentType<{ className?: string }>
}

const TABS: TabItem[] = [
  { id: 'general', label: '通用设置', icon: Sliders },
  { id: 'models', label: '模型服务', icon: Cpu },
  { id: 'knowledge-agent', label: '知识检索', icon: Database },
  { id: 'host-agent', label: '主机运维', icon: Server },
  { id: 'web-agent', label: '联网搜索', icon: Globe },
  { id: 'qq-bot', label: 'QQ 机器人', icon: Radio },
]

export default function Settings() {
  const { tab } = useParams<{ tab?: string }>()
  const navigate = useNavigate()

  const activeTab: TabKey = !tab || tab === 'general'
    ? 'general'
    : VALID_TABS.includes(tab as TabKey)
      ? (tab as TabKey)
      : 'general'

  // Gracefully redirect invalid sub-paths (e.g. /settings/unknown) back to /settings
  useEffect(() => {
    if (tab && !VALID_TABS.includes(tab as TabKey)) {
      navigate('/settings', { replace: true })
    }
  }, [tab, navigate])

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: api.getSettings,
  })

  const { data: qqSettings } = useQuery({
    queryKey: ['qq-settings'],
    queryFn: api.getQQSettings,
  })

  const handleTabChange = (key: TabKey) => {
    if (key === 'general') {
      navigate('/settings')
    } else {
      navigate(`/settings/${key}`)
    }
  }

  return (
    <div className="p-8 w-[880px] max-w-full mx-auto space-y-6">
      {/* Top Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">系统设置</h1>
        <p className="text-sm text-muted-foreground mt-1">
          管理系统通用参数、大模型服务商基座、知识库索引与通道网关
        </p>
      </div>

      {/* Underline Tab Navigation Bar */}
      <nav className="flex items-center gap-1 border-b border-border text-sm overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        {TABS.map((item) => {
          const isActive = activeTab === item.id
          const Icon = item.icon
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleTabChange(item.id)}
              className={`flex items-center gap-2 py-2.5 px-3.5 border-b-2 font-medium text-xs md:text-sm transition-all whitespace-nowrap cursor-pointer -mb-px ${
                isActive
                  ? 'border-primary text-foreground font-semibold'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
              }`}
            >
              <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
              <span>{item.label}</span>
            </button>
          )
        })}
      </nav>

      {/* Tab Panels with Keep-Alive Mounting */}
      <div className={activeTab === 'general' ? 'block' : 'hidden'}>
        <GeneralSettingsTab settings={settings} />
      </div>

      <div className={activeTab === 'models' ? 'block' : 'hidden'}>
        <ModelsTab settings={settings} />
      </div>

      <div className={activeTab === 'knowledge-agent' ? 'block' : 'hidden'}>
        <KnowledgeAgentTab settings={settings} />
      </div>

      <div className={activeTab === 'host-agent' ? 'block' : 'hidden'}>
        <HostAgentTab settings={settings} />
      </div>

      <div className={activeTab === 'web-agent' ? 'block' : 'hidden'}>
        <WebAgentTab settings={settings} />
      </div>

      <div className={activeTab === 'qq-bot' ? 'block' : 'hidden'}>
        <QQBotTab qqSettings={qqSettings} />
      </div>
    </div>
  )
}
