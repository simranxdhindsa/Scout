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
import { orgsApi, type ScoutOrg } from "@/lib/scout-api"

export function EditOrganisationDialog({
  org,
  open,
  onOpenChange,
  onSaved,
}: {
  org: ScoutOrg | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: () => Promise<void> | void
}) {
  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [isActive, setIsActive] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open && org) {
      setName(org.name)
      setSlug(org.slug)
      setIsActive(org.is_active)
      setError(null)
      setSaving(false)
    }
  }, [open, org])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!org || !name.trim() || !slug) return
    setSaving(true)
    setError(null)
    try {
      await orgsApi.update(org.id, {
        name: name.trim(),
        slug,
        is_active: isActive,
        theme: org.theme,
      })
      await onSaved?.()
      onOpenChange(false)
    } catch (err) {
      setError(
        (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error ?? "Failed to update organisation",
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit organisation</DialogTitle>
          <DialogDescription>
            Update the organisation's name, slug, or active status.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="edit-org-name">
              Name
            </label>
            <Input
              id="edit-org-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Inc."
              required
              autoFocus
              className="bg-muted/40 px-3"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="edit-org-slug">
              Slug
            </label>
            <Input
              id="edit-org-slug"
              value={slug}
              onChange={(e) =>
                setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))
              }
              placeholder="acme"
              required
              className="bg-muted/40 px-3 font-mono"
            />
          </div>

          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="size-4 accent-emerald-500"
            />
            Active
          </label>

          {error ? <p className="text-destructive text-sm">{error}</p> : null}

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !name.trim() || !slug}>
              {saving ? <Loader2Icon className="size-4 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
