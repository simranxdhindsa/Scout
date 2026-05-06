'use client'

import { Suspense, useEffect } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import { useAuthStore, setAuthCookie } from '@/lib/auth'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
})

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <Suspense>
        <AuthGate>
          {children}
          <Toaster
            position="bottom-right"
            toastOptions={{
              duration: 3500,
              style: {
                fontSize: '13px',
                borderRadius: '10px',
                background: '#12121f',
                color: '#ededf5',
                border: '1px solid #2a2a40',
                boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
                fontFamily: 'Inter, system-ui, sans-serif',
              },
              success: {
                iconTheme: { primary: '#34d399', secondary: '#042f1e' },
              },
              error: {
                iconTheme: { primary: '#f87171', secondary: '#2d0a0a' },
              },
            }}
          />
        </AuthGate>
      </Suspense>
    </QueryClientProvider>
  )
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { loadMe, isLoading, isAuthenticated } = useAuthStore()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  useEffect(() => {
    const token = searchParams.get('token')
    if (token) {
      setAuthCookie(token)
      router.replace(pathname)
    }
  }, [searchParams, pathname, router])

  useEffect(() => { loadMe() }, [loadMe])

  if (isLoading) {
    return (
      <div style={{
        display: 'flex',
        minHeight: '100vh',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#07070f',
        position: 'relative',
        zIndex: 1,
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
        </div>
      </div>
    )
  }

  if (!isAuthenticated && !pathname.startsWith('/login') && !pathname.startsWith('/auth')) {
    router.push('/login')
    return null
  }

  return <>{children}</>
}
