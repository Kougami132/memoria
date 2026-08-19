import { useState, useEffect } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { 
  Bot, 
  Database, 
  MessageSquare, 
  Sparkles, 
  Settings, 
  PanelLeftClose, 
  PanelLeft, 
  SquarePen,
  Sun,
  Moon,
  Sparkle
} from 'lucide-react'

const navLinks = [
  { to: '/chat', label: '常规对话', icon: MessageSquare },
  { to: '/agentic-chat', label: 'Agentic RAG', icon: Sparkles },
  { to: '/knowledge-bases', label: '知识库', icon: Database },
  { to: '/bots', label: 'Bots 助手', icon: Bot },
  { to: '/settings', label: '系统设置', icon: Settings },
]

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [isDark, setIsDark] = useState(() => {
    return document.documentElement.classList.contains('dark') || 
      window.matchMedia('(prefers-color-scheme: dark)').matches
  })
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [isDark])

  const toggleTheme = () => {
    setIsDark(!isDark)
  }

  const handleNewChat = () => {
    if (location.pathname === '/agentic-chat') {
      window.dispatchEvent(new CustomEvent('memoria:new-agentic-chat'))
    } else {
      navigate('/chat')
      window.dispatchEvent(new CustomEvent('memoria:new-chat'))
    }
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* Sidebar */}
      <aside 
        className={`flex flex-col bg-sidebar border-r border-sidebar-border transition-all duration-300 ease-in-out ${
          sidebarOpen ? 'w-[260px]' : 'w-0 -translate-x-full absolute md:relative'
        } shrink-0 z-30 h-full overflow-hidden`}
      >
        <div className="flex flex-col h-full w-[260px] p-3 justify-between">
          {/* Header & New Chat */}
          <div className="space-y-3">
            <div className="flex items-center justify-between px-2 py-1.5">
              <div className="flex items-center gap-2.5 font-semibold text-base tracking-tight text-foreground">
                <div className="w-7 h-7 rounded-lg bg-foreground text-background flex items-center justify-center shadow-sm">
                  <Sparkle className="w-4 h-4 fill-current" />
                </div>
                <span>Memoria</span>
              </div>
              <button 
                onClick={() => setSidebarOpen(false)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                title="收起侧边栏"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            </div>

            <button
              onClick={handleNewChat}
              className="flex items-center justify-between w-full px-3 py-2.5 rounded-xl border border-border bg-background hover:bg-accent transition-all text-sm font-medium shadow-sm hover:shadow"
            >
              <div className="flex items-center gap-2">
                <SquarePen className="w-4 h-4 text-muted-foreground" />
                <span>开启新对话</span>
              </div>
              <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono">⌘N</span>
            </button>

            {/* Navigation List */}
            <nav className="space-y-1 pt-2">
              <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                应用导航
              </div>
              {navLinks.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-accent text-foreground font-semibold shadow-xs'
                        : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                    }`
                  }
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{label}</span>
                </NavLink>
              ))}
            </nav>
          </div>

          {/* Footer controls */}
          <div className="pt-3 border-t border-sidebar-border space-y-1">
            <button
              onClick={toggleTheme}
              className="flex items-center justify-between w-full px-3 py-2 rounded-xl text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <div className="flex items-center gap-2.5">
                {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                <span>{isDark ? '浅色模式' : '深色模式'}</span>
              </div>
            </button>
            <div className="px-3 py-1.5 flex items-center justify-between text-[11px] text-muted-foreground/60">
              <span>Memoria AI</span>
              <span>v0.2.0</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Area */}
      <main className="flex-1 flex flex-col min-w-0 h-full relative overflow-hidden bg-background">
        {/* Toggle sidebar button when collapsed */}
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="absolute top-3 left-3 z-40 p-2 rounded-xl border border-border bg-background text-muted-foreground hover:text-foreground hover:bg-accent shadow-sm transition-all"
            title="展开侧边栏"
          >
            <PanelLeft className="w-4 h-4" />
          </button>
        )}
        <div className="flex-1 overflow-auto h-full flex flex-col">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
