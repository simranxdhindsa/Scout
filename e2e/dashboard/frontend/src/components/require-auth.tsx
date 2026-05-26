import { Loader2Icon } from "lucide-react"
import { Navigate, Outlet, useLocation } from "react-router-dom"

import { getAuthToken, useAuthStore } from "@/lib/auth"

function Splash() {
  return (
    <div className="bg-background flex min-h-svh items-center justify-center">
      <Loader2Icon className="text-muted-foreground size-6 animate-spin" />
    </div>
  )
}

export function RequireAuth() {
  const { isLoading, isAuthenticated } = useAuthStore()
  const location = useLocation()

  // Cookie exists but store hasn't finished hydrating yet — show splash.
  if (isLoading) return <Splash />

  if (!isAuthenticated) {
    const redirect = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?redirect=${redirect}`} replace />
  }

  return <Outlet />
}

export function RedirectIfAuthed() {
  const { isLoading, isAuthenticated } = useAuthStore()

  if (isLoading && getAuthToken()) return <Splash />
  if (isAuthenticated) return <Navigate to="/dashboard" replace />
  return <Outlet />
}
