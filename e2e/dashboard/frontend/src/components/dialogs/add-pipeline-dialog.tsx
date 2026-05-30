import { useState } from "react"
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
import { pipelinesApi, type Pipeline } from "@/lib/scout-api"

type Mode = { mode: "create" } | { mode: "edit"; pipeline: Pipeline }

export function AddPipelineDialog({
  open,
  onOpenChange,
  orgId,
  mode,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  orgId: string
  mode: Mode
  onSaved: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <PipelineForm
        orgId={orgId}
        mode={mode}
        onCancel={() => onOpenChange(false)}
        onSaved={onSaved}
      />
    </Dialog>
  )
}

function PipelineForm({
  orgId,
  mode,
  onCancel,
  onSaved,
}: {
  orgId: string
  mode: Mode
  onCancel: () => void
  onSaved: () => void
}) {
  const isEdit = mode.mode === "edit"
  const initial = isEdit ? mode.pipeline : null
  const [name, setName] = useState(initial?.name ?? "")
  const [description, setDescription] = useState(initial?.description ?? "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    setError(null)
    try {
      const body = {
        name: name.trim(),
        description: description.trim() ? description.trim() : null,
        steps: initial
          ? initial.steps.map((s) => ({
              target_type: s.target_type,
              target_id: s.target_id,
              order: s.order,
            }))
          : [],
      }
      if (isEdit && initial) {
        await pipelinesApi.update(orgId, initial.id, body)
      } else {
        await pipelinesApi.create(orgId, body)
      }
      onSaved()
    } catch (err) {
      setError(
        (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error ?? "Failed to save pipeline",
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>{isEdit ? "Edit pipeline" : "New pipeline"}</DialogTitle>
        <DialogDescription>
          {isEdit
            ? "Update the pipeline's name and description."
            : "Give your pipeline a name and an optional description."}
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="pipeline-name">
            Name
          </label>
          <Input
            id="pipeline-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Smoke + regression"
            required
            autoFocus
            className="bg-muted/40 px-3"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="pipeline-description">
            Description{" "}
            <span className="text-muted-foreground font-normal">
              (optional)
            </span>
          </label>
          <textarea
            id="pipeline-description"
            value={description ?? ""}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="What does this pipeline run?"
            className="bg-muted/40 ring-border/40 placeholder:text-muted-foreground resize-y p-3 text-sm outline-none ring-1 focus-visible:ring-primary"
          />
        </div>

        {isEdit && initial && initial.steps.length > 0 ? (
          <p className="text-muted-foreground text-xs">
            Steps ({initial.steps.length}) preserved on save — step editing is
            handled elsewhere.
          </p>
        ) : null}

        {error ? <p className="text-destructive text-sm">{error}</p> : null}

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || !name.trim()}>
            {saving ? <Loader2Icon className="size-4 animate-spin" /> : null}
            {isEdit ? "Save changes" : "Create"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
