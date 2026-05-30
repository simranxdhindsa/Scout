import { Link } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { ModeToggle } from "@/components/mode-toggle"

export default function HomePage() {
  return (
    <div className="bg-background relative flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
      <div className="absolute top-4 right-4">
        <ModeToggle />
      </div>
      <h1 className="text-3xl font-semibold">Scout</h1>
      <div className="flex gap-2">
        <Button asChild>
          <Link to="/login">Go to login</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/dashboard">Go to dashboard</Link>
        </Button>
      </div>
    </div>
  )
}
