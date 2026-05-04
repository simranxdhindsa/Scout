'use client'

import { Suspense } from 'react'
import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { setAuthCookie } from '@/lib/auth'

function CallbackInner() {
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const token = searchParams.get('token')
    const error = searchParams.get('error')

    if (error) {
      router.replace('/login?error=' + error)
      return
    }

    if (token) {
      setAuthCookie(token)
      router.replace('/')
    } else {
      router.replace('/login')
    }
  }, [router, searchParams])

  return null
}

export default function AuthCallbackPage() {
  return (
    <div style={{
      display: 'flex',
      minHeight: '100vh',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#07070f',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          border: '2px solid rgba(99,102,241,0.2)',
          borderTopColor: '#818cf8',
          animation: 'spin 0.7s linear infinite',
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <p style={{ fontSize: 13, color: '#3a3a52', fontFamily: 'Inter, sans-serif' }}>
          Signing you in…
        </p>
        <Suspense>
          <CallbackInner />
        </Suspense>
      </div>
    </div>
  )
}
