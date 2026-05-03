'use client'

import { Sidebar } from '@/components/layout/Sidebar'

interface OrgLayoutProps {
  children: React.ReactNode
  params: { orgSlug: string }
}

export default function OrgLayout({ children, params }: OrgLayoutProps) {
  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      overflow: 'hidden',
      position: 'relative',
      zIndex: 1,
    }}>
      <Sidebar orgSlug={params.orgSlug} />
      <main style={{
        marginLeft: 240,
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative',
      }}>
        {children}
      </main>
    </div>
  )
}
