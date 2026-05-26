import { useEffect } from "react"

import { useAuthStore } from "@/lib/auth"

export function AuthBootstrap({ children }: { children: React.ReactNode }) {
  const loadMe = useAuthStore((s) => s.loadMe)

  useEffect(() => {
    loadMe()
  }, [loadMe])

  return <>{children}</>
}
