import { UploadCloud } from "lucide-react"

export function Header() {
  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-6">
        <UploadCloud className="h-5 w-5 text-primary" />
        <span className="text-base font-semibold text-foreground">File Upload</span>
      </div>
    </header>
  )
}
