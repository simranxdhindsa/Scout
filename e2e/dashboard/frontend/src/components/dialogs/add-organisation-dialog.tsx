import { useEffect, useState } from "react"
import { Loader2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { orgsApi, slugify } from "@/lib/scout-api"

export function AddOrganisationDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: () => Promise<void> | void
}) {
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [slugTouched, setSlugTouched] = useState(false)
  const [isActive, setIsActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setName("")
      setSlug("")
      setSlugTouched(false)
      setIsActive(true)
      setError(null)
      setSaving(false)
    }
  }, [open])

  const effectiveSlug = slugTouched ? slug : slugify(name)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !effectiveSlug) return
    setSaving(true)
    setError(null)
    try {
      await orgsApi.create({
        name: name.trim(),
        slug: effectiveSlug,
        is_active: isActive,
      })
      await onCreated?.()
      onOpenChange(false)
    } catch (err) {
      setError(
        (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error ?? "Failed to create organisation",
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New organisation</DialogTitle>
          <DialogDescription>
            Create a new organisation to group projects, members, and runs.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="org-name">
              Name
            </label>
            <Input
              id="org-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Inc."
              required
              autoFocus
              className="bg-muted/40 px-3"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="org-slug">
              Slug
            </label>
            <Input
              id="org-slug"
              value={effectiveSlug}
              onChange={(e) => {
                setSlugTouched(true)
                setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))
              }}
              placeholder="acme"
              required
              className="bg-muted/40 px-3 font-mono"
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <label
              htmlFor="add-org-active"
              className="flex flex-col text-sm font-medium"
            >
              Active
              <span className="text-muted-foreground text-xs font-normal">
                Inactive organisations are hidden from the team switcher.
              </span>
            </label>
            <Switch
              id="add-org-active"
              checked={isActive}
              onCheckedChange={setIsActive}
            />
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
            <Button
              type="submit"
              disabled={saving || !name.trim() || !effectiveSlug}
            >
              {saving ? <Loader2Icon className="size-4 animate-spin" /> : null}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
