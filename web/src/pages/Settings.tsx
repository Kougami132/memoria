import { useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Sliders, Database, Server, Globe, Radio } from 'lucide-react'
import * as api from '@/api'
import GeneralSettingsTab from './settings/GeneralSettingsTab'
import KnowledgeAgentTab from './settings/KnowledgeAgentTab'
import HostAgentTab from './settings/HostAgentTab'
import WebAgentTab from './settings/WebAgentTab'
import QQBotTab from './settings/QQBotTab'

const VALID_TABS = ['general', 'knowledge-agent', 'host-agent', 'web-agent', 'qq-bot'] as const
type TabKey = typeof VALID_TABS[number]

interface TabItem {
  id: TabKey
  label: string
  badge: string
  icon: React.ComponentType<{ className?: string }>
}

const TABS: TabItem[] = [
  { id: 'general', label: '全局基础', badge: 'General', icon: Sliders },
  { id: 'knowledge-agent', label: '知识检索', badge: 'KnowledgeAgent', icon: Database },
  { id: 'host-agent', label: '主机运维', badge: 'HostAgent', icon: Server },
  { id: 'web-agent', label: '联网搜索', badge: 'WebAgent', icon: Globe },
  { id: 'qq-bot', label: 'QQ 机器人', badge: 'QQBot 通道', icon: Radio },
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
          管理全局模型基座、领域专家智能体及通道网关配置
        </p>
      </div>

      {/* Horizontal Segmented Tab Navigation Bar */}
      <div className="flex items-center gap-1.5 p-1.5 bg-secondary/50 rounded-2xl border border-border/80 overflow-x-auto shadow-2xs">
        {TABS.map(item => {
          const isActive = activeTab === item.id
          const Icon = item.icon
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleTabChange(item.id)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium transition-all whitespace-nowrap cursor-pointer ${
                isActive
                  ? 'bg-background text-foreground shadow-xs font-semibold'
                  : 'text-muted-foreground hover:text-foreground hover:bg-background/40'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
              <span>{item.label}</span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-md font-mono ${
                  isActive
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'bg-muted/70 text-muted-foreground'
                }`}
              >
                {item.badge}
              </span>
            </button>
          )
        })}
      </div>

      {/* Tab Panels with Keep-Alive Mounting */}
      <div className={activeTab === 'general' ? 'block' : 'hidden'}>
        <GeneralSettingsTab settings={settings} />
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
