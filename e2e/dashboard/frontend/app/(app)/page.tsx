'use client'

import { Suspense } from 'react'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/lib/auth'

function RootRedirect() {
  const router = useRouter()
  const { orgs, isLoading, isPlatformAdmin } = useAuthStore()

  useEffect(() => {
    if (isLoading) return
    if (isPlatformAdmin) {
      router.replace(orgs.length > 0 ? `/${orgs[0].slug}` : '/admin/orgs')
      return
    }
    if (orgs.length > 0) {
      router.replace(`/${orgs[0].slug}`)
    }
  }, [orgs, isLoading, isPlatformAdmin, router])

  const noOrg = !isLoading && !isPlatformAdmin && orgs.length === 0

  if (noOrg) {
    return (
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontSize: 15, color: '#ededf5', marginBottom: 8 }}>No organization found</p>
        <p style={{ fontSize: 13, color: '#3a3a52' }}>Ask a platform admin to add you to an org.</p>
      </div>
    )
  }

  return null
}

export default function RootPage() {
  return (
    <div style={{
      display: 'flex',
      minHeight: '100vh',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#07070f',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          border: '2px solid rgba(99,102,241,0.2)',
          borderTopColor: '#818cf8',
          animation: 'spin 0.7s linear infinite',
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <p style={{ fontSize: 12, color: '#3a3a52', fontFamily: 'Inter, sans-serif' }}>Loading Scout…</p>
        <Suspense>
          <RootRedirect />
        </Suspense>
      </div>
    </div>
  )
}
