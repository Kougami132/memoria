import { NavLink, Outlet } from 'react-router-dom'

const links = [
  { to: '/knowledge-bases', label: 'Knowledge Bases' },
  { to: '/bots', label: 'Bots' },
  { to: '/chat', label: 'Chat' },
  { to: '/settings', label: 'Settings' },
]

export default function Layout() {
  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b">
        <div className="container mx-auto flex h-14 items-center gap-6 px-4">
          <span className="font-semibold text-lg">Memoria</span>
          {links.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `text-sm transition-colors ${isActive ? 'text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'}`
              }
            >
              {label}
            </NavLink>
          ))}
        </div>
      </nav>
      <main className="container mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
