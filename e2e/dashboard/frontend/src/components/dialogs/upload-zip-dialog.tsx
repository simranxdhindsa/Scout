import { useEffect, useState } from "react"
import { Loader2Icon, UploadIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type { ImportResult } from "@/lib/scout-api"

// onUpload receives the chosen .zip and resolves with the import summary. The
// caller owns what "import" means (which sub-project, whether to create one),
// so this dialog stays a thin file-picker + result reporter.
export function UploadZipDialog({
  open,
  onOpenChange,
  onUpload,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpload: (file: File) => Promise<ImportResult>
}) {
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setFile(null)
      setUploading(false)
      setError(null)
    }
  }, [open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      await onUpload(file)
      onOpenChange(false)
    } catch (err) {
      setError(
        (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error ?? "Failed to import zip",
      )
    } finally {
      setUploading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload zip</DialogTitle>
          <DialogDescription>
            Upload a .zip of Playwright spec files. The server extracts it and
            imports every <code>*.spec.ts/js</code> and{" "}
            <code>*.test.ts/js</code>, recreating the folder structure. Existing
            tests with the same filename are updated; nothing is deleted.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="zip-file">
              Archive
            </label>
            <input
              id="zip-file"
              type="file"
              accept=".zip,application/zip"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="bg-muted/40 ring-border/40 file:bg-muted file:text-foreground file:mr-3 file:border-0 file:px-3 file:py-2 p-0 text-sm outline-none ring-1 focus-visible:ring-primary"
            />
            {file ? (
              <p className="text-muted-foreground text-xs">
                {file.name} · {(file.size / 1024).toFixed(0)} KB
              </p>
            ) : null}
          </div>

          {error ? <p className="text-destructive text-sm">{error}</p> : null}

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={uploading || !file}>
              {uploading ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <UploadIcon className="size-4" />
              )}
              {uploading ? "Importing…" : "Upload & import"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
