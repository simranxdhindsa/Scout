'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, PlayCircle, GitBranch,
  PackageSearch, Bot, Settings, ChevronDown,
  ChevronRight, Building2, LogOut, FileCode2, Plus,
} from 'lucide-react'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { productsApi, subProjectsApi } from '@/lib/api'
import { useAuthStore } from '@/lib/auth'
import s from './Sidebar.module.css'

interface NavItem {
  label: string
  href: string
  icon: React.ReactNode
  exact?: boolean
  children?: NavItem[]
}

interface SidebarProps { orgSlug: string }

export function Sidebar({ orgSlug }: SidebarProps) {
  const pathname = usePathname()
  const { user, orgs, isPlatformAdmin, logout } = useAuthStore()
  const base = `/${orgSlug}`

  const workspaceItems: NavItem[] = [
    { label: 'Overview',     href: base,                   icon: <LayoutDashboard size={15} />, exact: true },
    { label: 'Runs',         href: `${base}/runs`,         icon: <PlayCircle size={15} /> },
    { label: 'Pipelines',    href: `${base}/pipelines`,    icon: <GitBranch size={15} /> },
    { label: 'AI Assistant', href: `${base}/ai`,           icon: <Bot size={15} /> },
  ]

  const toolItems: NavItem[] = [
    { label: 'SCORM Scraper', href: `${base}/scorm`, icon: <PackageSearch size={15} /> },
  ]

  const settingsItem: NavItem = {
    label: 'Settings', href: `${base}/settings`, icon: <Settings size={15} />,
    children: [
      { label: 'Environments', href: `${base}/settings/environments`, icon: null },
      { label: 'Members',      href: `${base}/settings/members`,      icon: null },
      { label: 'Archive Queue',href: `${base}/settings/archive-queue`,icon: null },
      { label: 'AI Config',    href: `${base}/settings/ai-config`,    icon: null },
    ],
  }

  const initials = (user?.name ?? orgSlug).slice(0, 2).toUpperCase()

  return (
    <aside className={s.sidebar}>
      {/* Logo */}
      <div className={s.logoRow}>
        <div className={s.logoMark}>S</div>
        <span className={s.logoName}>Scout</span>
      </div>

      {/* Org switcher */}
      <OrgSwitcher orgSlug={orgSlug} orgs={orgs} />

      <div className={s.scrollArea}>
        {/* Workspace nav */}
        <div style={{ marginTop: 12 }}>
          <div className={s.section}>
            <div className={s.sectionLabel}>Workspace</div>
            <ul className={s.nav}>
              {workspaceItems.map((item) => {
                const active = item.exact ? pathname === item.href : pathname.startsWith(item.href)
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`${s.navItem} ${active ? s.navItemActive : ''}`}
                    >
                      {item.icon}
                      <span>{item.label}</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>

        <div className={s.divider} />

        {/* Products nav */}
        <div className={s.section}>
          <div className={s.sectionLabel}>Products</div>
          <ProductsSection orgSlug={orgSlug} orgId={orgs.find(o => o.slug === orgSlug)?.id ?? ''} pathname={pathname} s={s} />
        </div>

        <div className={s.divider} />

        {/* Tools */}
        <div className={s.section}>
          <div className={s.sectionLabel}>Tools</div>
          <ul className={s.nav}>
            {toolItems.map((item) => {
              const active = pathname.startsWith(item.href)
              return (
                <li key={item.href}>
                  <Link href={item.href} className={`${s.navItem} ${active ? s.navItemActive : ''}`}>
                    {item.icon}
                    <span>{item.label}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>

        <div className={s.divider} />

        {/* Settings */}
        <div className={s.section}>
          <ul className={s.nav}>
            <NavItemRow item={settingsItem} pathname={pathname} s={s} />
          </ul>
        </div>
      </div>

      {/* User footer */}
      <div className={s.sidebarBottom}>
        <div className={s.userRow}>
          <div className={s.userAvatar}>
            {user?.avatar_url
              ? <img src={user.avatar_url} alt={user.name} />
              : initials}
          </div>
          <div className={s.userInfo}>
            <span className={s.userName}>{user?.name ?? 'User'}</span>
            {isPlatformAdmin
              ? <span className={s.adminBadge}>Platform Admin</span>
              : <span className={s.roleBadge}>Admin</span>}
          </div>
          <button className={s.logoutBtn} onClick={logout} title="Sign out" aria-label="Sign out">
            <LogOut size={14} />
          </button>
        </div>

        {isPlatformAdmin && (
          <Link href="/admin/orgs" className={s.adminLink}>
            <Building2 size={11} />
            Platform Admin
          </Link>
        )}
      </div>
    </aside>
  )
}

function OrgSwitcher({ orgSlug, orgs }: { orgSlug: string; orgs: { slug: string; name: string }[] }) {
  const [open, setOpen] = useState(false)
  const current = orgs.find((o) => o.slug === orgSlug)
  const initials = (current?.name ?? orgSlug).slice(0, 2).toUpperCase()

  return (
    <div className={s.sidebarTop}>
      <button className={s.orgSwitcher} onClick={() => setOpen(!open)}>
        <div className={s.orgAvatar}>{initials}</div>
        <div className={s.orgInfo}>
          <span className={s.orgName}>{current?.name ?? orgSlug}</span>
          <span className={s.orgType}>Workspace</span>
        </div>
        <ChevronDown size={12} style={{ color: 'var(--text-muted)', marginLeft: 'auto', flexShrink: 0 }} />
      </button>

      {open && (
        <div className={s.orgDropdown}>
          <div className={s.dropdownLabel}>Switch Workspace</div>
          {orgs.map((org) => (
            <div
              key={org.slug}
              className={`${s.dropdownItem} ${org.slug === orgSlug ? s.dropdownItemActive : ''}`}
              onClick={() => setOpen(false)}
            >
              <Link href={`/${org.slug}`} style={{ color: 'inherit', textDecoration: 'none', flex: 1 }}>
                {org.name}
              </Link>
              {org.slug === orgSlug && <ChevronRight size={11} style={{ color: 'var(--accent)' }} />}
            </div>
          ))}
          <div className={s.dropdownDivider} />
          <div className={s.dropdownItem}>
            <Link href="/admin/orgs" style={{ color: 'inherit', textDecoration: 'none' }}>New Organization</Link>
          </div>
        </div>
      )}
    </div>
  )
}

function NavItemRow({ item, pathname, s }: { item: NavItem; pathname: string; s: Record<string, string> }) {
  const [expanded, setExpanded] = useState(
    item.children?.some((c) => pathname.startsWith(c.href)) ?? false
  )
  const isActive = item.exact ? pathname === item.href : pathname.startsWith(item.href)

  if (item.children) {
    return (
      <li>
        <button
          onClick={() => setExpanded(!expanded)}
          className={`${s.navItem} ${isActive ? s.navItemActive : ''}`}
          style={{ width: '100%', textAlign: 'left' }}
        >
          {item.icon}
          <span style={{ flex: 1 }}>{item.label}</span>
          {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </button>
        {expanded && (
          <ul className={s.nav} style={{ paddingLeft: 8 }}>
            {item.children.map((child) => {
              const childActive = pathname === child.href
              return (
                <li key={child.href}>
                  <Link
                    href={child.href}
                    className={`${s.navItem} ${s.subItem} ${childActive ? s.navItemActive : ''}`}
                  >
                    {child.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </li>
    )
  }

  return (
    <li>
      <Link href={item.href} className={`${s.navItem} ${isActive ? s.navItemActive : ''}`}>
        {item.icon}
        {item.label}
      </Link>
    </li>
  )
}

function ProductsSection({ orgSlug, orgId, pathname, s }: { orgSlug: string; orgId: string; pathname: string; s: Record<string, string> }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const base = `/${orgSlug}`

  const { data } = useQuery({
    queryKey: ['products', orgId],
    queryFn: () => productsApi.list(orgId).then((r) => r.data),
    enabled: !!orgId,
    staleTime: 30_000,
  })

  const products = data?.products ?? []

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <ul className={s.nav}>
      {products.map((product: any) => (
        <ProductNavItem
          key={product.id}
          product={product}
          orgSlug={orgSlug}
          orgId={orgId}
          pathname={pathname}
          isExpanded={expanded.has(product.id)}
          onToggle={() => toggle(product.id)}
          s={s}
        />
      ))}
      <li>
        <Link
          href={`${base}/products`}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontSize: 12, color: 'var(--text-muted)', textDecoration: 'none',
            padding: '6px 8px', borderRadius: 'var(--radius-sm)',
            width: '100%',
          }}
        >
          <Plus size={12} /> Add Product
        </Link>
      </li>
    </ul>
  )
}

function ProductNavItem({ product, orgSlug, orgId, pathname, isExpanded, onToggle, s }: {
  product: any; orgSlug: string; orgId: string; pathname: string;
  isExpanded: boolean; onToggle: () => void; s: Record<string, string>
}) {
  const { data } = useQuery({
    queryKey: ['subprojects', orgId, product.id],
    queryFn: () => subProjectsApi.list(orgId, product.id).then((r) => r.data),
    enabled: isExpanded,
    staleTime: 30_000,
  })

  const subProjects: any[] = data?.sub_projects ?? []

  return (
    <>
      <li>
        <button
          onClick={onToggle}
          className={s.navItem}
          style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer' }}
        >
          {isExpanded
            ? <ChevronDown size={10} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            : <ChevronRight size={10} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          }
          <FileCode2 size={14} style={{ flexShrink: 0 }} />
          <span>{product.name}</span>
        </button>
      </li>
      {isExpanded && subProjects.map((sp: any) => {
        const href = `/${orgSlug}/products/${product.slug}/${sp.slug}`
        const active = pathname.startsWith(href)
        return (
          <li key={sp.id}>
            <Link
              href={href}
              className={`${s.navItem} ${s.subItem} ${active ? s.navItemActive : ''}`}
            >
              <span style={{ width: 10, flexShrink: 0 }} />
              <span>{sp.name}</span>
            </Link>
          </li>
        )
      })}
    </>
  )
}
