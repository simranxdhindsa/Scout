import { useEffect } from "react"
import { Loader2Icon } from "lucide-react"
import { useNavigate, useSearchParams } from "react-router-dom"

import { setAuthCookie, useAuthStore } from "@/lib/auth"

export default function AuthCallbackPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const loadMe = useAuthStore((s) => s.loadMe)

  useEffect(() => {
    const token = params.get("token")
    const error = params.get("error")

    
    if (error) {
      navigate(`/login?error=${encodeURIComponent(error)}`, { replace: true })
      return
    }
    if (!token) {
      navigate("/login", { replace: true })
      return
    }

    setAuthCookie(token)
    loadMe().then(() => {
      navigate("/dashboard", { replace: true })
    })
  }, [params, navigate, loadMe])

  return (
    <div className="bg-muted flex min-h-svh items-center justify-center">
      <Loader2Icon className="text-muted-foreground size-12 animate-spin" />
    </div>
  )
}
