import { Navigate, Outlet, useLocation } from "react-router-dom"

import { getAuthToken, useAuthStore } from "@/lib/auth"
import { SDrawLoader } from "@/components/loaders/SDrawLoader"

function Splash() {
  return (
    <div
      className="flex min-h-svh items-center justify-center"
      style={{ background: "#0b0b10" }}
    >
      <SDrawLoader />
    </div>
  )
}

export function RequireAuth() {
  const { isLoading, isAuthenticated } = useAuthStore()
  const location = useLocation()

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
