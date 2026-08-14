import { NavLink, Outlet } from 'react-router-dom'
import { Brain, Database, Bot, MessageSquare, Settings, Sparkles } from 'lucide-react'

const links = [
  { to: '/knowledge-bases', label: '知识库', icon: Database },
  { to: '/bots', label: '机器人', icon: Bot },
  { to: '/chat', label: '对话', icon: MessageSquare },
  { to: '/agentic-chat', label: 'Agentic RAG', icon: Sparkles },
  { to: '/settings', label: '设置', icon: Settings },
]

export default function Layout() {
  return (
    <div className="flex h-screen bg-background">
      <aside className="flex w-60 shrink-0 flex-col bg-gradient-to-b from-slate-900 via-purple-950 to-slate-900">
        <div className="flex h-14 shrink-0 items-center gap-2.5 px-5">
          <div className="shrink-0 rounded-xl bg-gradient-to-br from-purple-500 to-blue-500 p-1.5">
            <Brain className="h-4 w-4 text-white" />
          </div>
          <span className="text-base font-bold tracking-tight text-white">Memoria</span>
        </div>
        <nav className="flex-1 space-y-0.5 p-3">
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-white/15 text-white'
                    : 'text-white/60 hover:bg-white/10 hover:text-white'
                }`
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="shrink-0 px-5 py-3">
          <p className="text-xs text-white/30">RAG 记忆系统 v0.1</p>
        </div>
      </aside>
      <main className="min-h-0 flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
