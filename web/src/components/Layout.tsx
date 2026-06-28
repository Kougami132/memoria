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
      <aside className="w-56 border-r flex flex-col bg-card shrink-0">
        <div className="flex items-center gap-2.5 px-5 h-14 border-b shrink-0">
          <Brain className="h-5 w-5 text-primary shrink-0" />
          <span className="font-semibold text-base tracking-tight">Memoria</span>
        </div>
        <nav className="flex-1 p-3 space-y-0.5">
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="px-4 py-3 border-t shrink-0">
          <p className="text-xs text-muted-foreground">RAG 记忆系统</p>
        </div>
      </aside>
      <main className="flex-1 min-h-0 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
