'use client'

import { ChevronRight, Search } from 'lucide-react'
import { NotificationBell } from './NotificationBell'
import s from './Topbar.module.css'

interface TopbarProps {
  title?: string
  breadcrumb?: { label: string; href?: string }[]
  actions?: React.ReactNode
}

export function Topbar({ title, breadcrumb, actions }: TopbarProps) {
  return (
    <header className={s.topbar}>
      <div className={s.breadcrumb}>
        {breadcrumb
          ? breadcrumb.map((crumb, i) => (
              <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {i > 0 && <ChevronRight size={12} className={s.crumbSep} />}
                {i < breadcrumb.length - 1
                  ? <span className={s.crumb}>{crumb.label}</span>
                  : <span className={s.crumbActive}>{crumb.label}</span>}
              </span>
            ))
          : title && <span className={s.crumbActive}>{title}</span>}
      </div>

      <div className={s.right}>
        {actions}

        <button className={s.searchBtn} aria-label="Search">
          <Search size={12} />
          <span>Search…</span>
          <kbd className={s.kbd}>⌘K</kbd>
        </button>

        <NotificationBell />
      </div>
    </header>
  )
}
