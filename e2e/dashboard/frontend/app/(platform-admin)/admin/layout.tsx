'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Building2, Users, ArrowLeft } from 'lucide-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuthStore } from '@/lib/auth'
import s from './Admin.module.css'

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } })

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={queryClient}><AdminShell>{children}</AdminShell></QueryClientProvider>
}

function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { user } = useAuthStore()

  const navItems = [
    { href: '/admin/orgs',  label: 'Organizations', icon: <Building2 size={15} /> },
    { href: '/admin/users', label: 'Users',          icon: <Users size={15} /> },
  ]

  return (
    <div className={s.shell}>
      <aside className={s.sidebar}>
        <div className={s.sidebarLogo}>
          <div className={s.logoMark}>S</div>
          <div>
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Scout Admin</p>
            <p style={{ fontSize: 10, color: 'var(--text-muted)' }}>Platform Console</p>
          </div>
          <span className={s.adminBadge} style={{ marginLeft: 'auto' }}>Admin</span>
        </div>

        <nav className={s.sidebarNav}>
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`${s.navItem} ${pathname.startsWith(item.href) ? s.navItemActive : ''}`}
            >
              {item.icon}
              {item.label}
            </Link>
          ))}
        </nav>

        <div className={s.sidebarBottom}>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user?.email}
          </p>
          <Link href="/" className={s.backLink}>
            <ArrowLeft size={11} /> Back to app
          </Link>
        </div>
      </aside>

      <main className={s.main}>
        {children}
      </main>
    </div>
  )
}
