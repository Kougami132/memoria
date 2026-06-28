import { NavLink, Outlet } from 'react-router-dom'
import { Brain, Database, Bot, MessageSquare, Settings } from 'lucide-react'

const links = [
  { to: '/knowledge-bases', label: '知识库', icon: Database },
  { to: '/bots', label: '机器人', icon: Bot },
  { to: '/chat', label: '对话', icon: MessageSquare },
  { to: '/settings', label: '设置', icon: Settings },
]

export default function Layout() {
  return (
    <div className="flex h-screen bg-background">
      <aside className="w-60 flex flex-col shrink-0 bg-gradient-to-b from-slate-900 via-purple-950 to-slate-900">
        <div className="flex items-center gap-2.5 px-5 h-14 shrink-0">
          <div className="bg-gradient-to-br from-purple-500 to-blue-500 rounded-xl p-1.5 shrink-0">
            <Brain className="h-4 w-4 text-white" />
          </div>
          <span className="font-bold text-base tracking-tight text-white">Memoria</span>
        </div>
        <nav className="flex-1 p-3 space-y-0.5">
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-white/15 text-white'
                    : 'text-white/60 hover:text-white hover:bg-white/10'
                }`
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="px-5 py-3 shrink-0">
          <p className="text-xs text-white/30">RAG 记忆系统 v0.1</p>
        </div>
      </aside>
      <main className="flex-1 min-h-0 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
