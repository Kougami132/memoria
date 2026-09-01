import { useState, useEffect } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { 
  Bot,
  ScrollText, 
  Database, 
  MessageSquare, 
  Sparkles, 
  Settings, 
  Server,
  PanelLeftClose, 
  PanelLeft,
  Sun,
  Moon,
  Sparkle
} from 'lucide-react'

const navLinks = [
  { to: '/chat', label: '常规对话', icon: MessageSquare },
  { to: '/agentic-chat', label: 'AI Agent', icon: Sparkles },
  { to: '/knowledge-bases', label: '知识库', icon: Database },
  { to: '/hosts', label: '主机管理', icon: Server },
  { to: '/bots', label: 'Bots 助手', icon: Bot },
  { to: '/logs', label: '日志', icon: ScrollText },
  { to: '/settings', label: '系统设置', icon: Settings },
]

const newChatPaths = new Set(['/chat', '/agentic-chat'])

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [isDark, setIsDark] = useState(() => {
    return document.documentElement.classList.contains('dark') || 
      window.matchMedia('(prefers-color-scheme: dark)').matches
  })

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

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      {/* ChatGPT-style Collapsible Sidebar */}
      <aside 
        className={`flex flex-col bg-sidebar border-r border-sidebar-border transition-[width] duration-200 ease-in-out shrink-0 z-30 h-full overflow-hidden ${
          sidebarOpen ? 'w-[260px]' : 'w-[52px]'
        }`}
      >
        {sidebarOpen ? (
          /* Expanded Full Sidebar */
          <div className="flex flex-col h-full w-[260px] p-3 justify-between">
            {/* Header & Navigation */}
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
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
                  title="收起侧边栏"
                >
                  <PanelLeftClose className="w-4 h-4" />
                </button>
              </div>

              {/* Navigation List */}
              <nav className="space-y-1 pt-2">
                <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  应用导航
                </div>
                {navLinks.map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    onClick={() => {
                      if (newChatPaths.has(to)) window.dispatchEvent(new Event('memoria:new-chat'))
                    }}
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
                className="flex items-center justify-between w-full px-3 py-2 rounded-xl text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors cursor-pointer"
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
        ) : (
          /* Collapsed Mini Icon Bar (ChatGPT Style) */
          <div className="flex flex-col h-full w-[52px] py-3 items-center justify-between">
            {/* Top icon buttons */}
            <div className="flex flex-col items-center gap-2 w-full px-2">
              {/* Expand Toggle */}
              <button
                onClick={() => setSidebarOpen(true)}
                className="w-9 h-9 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
                title="展开侧边栏"
              >
                <PanelLeft className="w-4 h-4" />
              </button>

              <div className="w-6 h-[1px] bg-sidebar-border my-1" />

              {/* Nav Icons */}
              {navLinks.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={() => {
                    if (newChatPaths.has(to)) window.dispatchEvent(new Event('memoria:new-chat'))
                  }}
                  className={({ isActive }) =>
                    `w-9 h-9 rounded-xl flex items-center justify-center transition-colors ${
                      isActive
                        ? 'bg-accent text-foreground shadow-xs font-semibold'
                        : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
                    }`
                  }
                  title={label}
                >
                  <Icon className="w-4 h-4" />
                </NavLink>
              ))}
            </div>

            {/* Bottom Dark Mode Toggle */}
            <div className="flex flex-col items-center gap-2 w-full px-2 pt-2 border-t border-sidebar-border/60">
              <button
                onClick={toggleTheme}
                className="w-9 h-9 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors cursor-pointer"
                title={isDark ? '切换浅色模式' : '切换深色模式'}
              >
                {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
            </div>
          </div>
        )}
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 h-full relative overflow-hidden bg-background">
        <div className="flex-1 overflow-auto h-full flex flex-col">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
