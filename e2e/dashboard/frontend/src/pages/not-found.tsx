import { useEffect } from "react"
import { Link } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { ScoutIconMark } from "@/components/ScoutLogo"

export default function NotFoundPage() {
  useEffect(() => {
    document.title = "Not Found — SCOUT"
  }, [])

  return (
    <div className="bg-background flex min-h-svh flex-col items-center justify-center gap-4 p-6">
      <div style={{ opacity: 0.3 }}>
        <ScoutIconMark size={64} />
      </div>
      <h1 className="text-4xl font-semibold">404</h1>
      <p className="text-muted-foreground">This page does not exist.</p>
      <Button asChild variant="outline">
        <Link to="/">Back home</Link>
      </Button>
    </div>
  )
}
