import { useCallback, useEffect, useState } from "react"
import {
  CalendarClockIcon,
  ClockIcon,
  Loader2Icon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  TrashIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { useActiveOrg } from "@/lib/auth"
import {
  scheduledRunsApi,
  type ScheduledRun,
  type ScheduledRunBody,
} from "@/lib/scout-api"

type ApiError = { response?: { data?: { error?: string } } }
function readError(err: unknown, fallback: string) {
  return (err as ApiError)?.response?.data?.error ?? fallback
}

const CRON_PRESETS = [
  { label: "Every Monday 9am",  value: "0 9 * * 1" },
  { label: "Every day 8am",     value: "0 8 * * *" },
  { label: "Every hour",        value: "0 * * * *" },
  { label: "Every 6 hours",     value: "0 */6 * * *" },
  { label: "Every Sunday 6am",  value: "0 6 * * 0" },
  { label: "Custom",            value: "" },
]

function formatNext(iso: string | null) {
  if (!iso) return "—"
  const d = new Date(iso)
  return d.toLocaleString("en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  })
}

function formatLast(iso: string | null) {
  if (!iso) return "Never"
  const d = new Date(iso)
  return d.toLocaleString("en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  })
}

// ── Form Dialog ───────────────────────────────────────────────────────────────

function ScheduleFormDialog({
  open,
  onClose,
  onSave,
  initial,
}: {
  open: boolean
  onClose: () => void
  onSave: (body: ScheduledRunBody) => Promise<void>
  initial?: ScheduledRun
}) {
  const [label, setLabel] = useState(initial?.label ?? "")
  const [cronPreset, setCronPreset] = useState(() => {
    const v = initial?.cron_expr ?? "0 9 * * 1"
    return CRON_PRESETS.find((p) => p.value === v) ? v : ""
  })
  const [cronCustom, setCronCustom] = useState(
    CRON_PRESETS.find((p) => p.value === (initial?.cron_expr ?? "0 9 * * 1"))
      ? ""
      : (initial?.cron_expr ?? ""),
  )
  const [product, setProduct] = useState(initial?.product ?? "ui")
  const [saving, setSaving] = useState(false)

  const cronExpr = cronPreset !== "" ? cronPreset : cronCustom

  const handleSave = async () => {
    if (!label.trim() || !cronExpr.trim()) return
    setSaving(true)
    try {
      await onSave({ label: label.trim(), cron_expr: cronExpr.trim(), product })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit schedule" : "New schedule"}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="space-y-1">
            <Label>Label</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Nightly regression"
            />
          </div>
          <div className="space-y-1">
            <Label>Schedule</Label>
            <div className="grid grid-cols-2 gap-2">
              {CRON_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => {
                    setCronPreset(p.value)
                    if (p.value !== "") setCronCustom("")
                  }}
                  className={`ring-border/40 px-3 py-1.5 text-left text-sm ring-1 transition-colors ${
                    (p.value !== "" ? cronPreset === p.value : cronPreset === "")
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/30 hover:bg-muted/60"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {cronPreset === "" && (
              <Input
                className="mt-2 font-mono text-sm"
                value={cronCustom}
                onChange={(e) => setCronCustom(e.target.value)}
                placeholder="0 9 * * 1-5"
              />
            )}
            <p className="text-muted-foreground text-xs">
              Cron expression: <span className="font-mono">{cronExpr || "—"}</span>
            </p>
          </div>
          <div className="space-y-1">
            <Label>Product</Label>
            <div className="flex gap-2">
              {["ui", "mission-control", "studio-web"].map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setProduct(p)}
                  className={`ring-border/40 px-3 py-1 text-sm ring-1 transition-colors ${
                    product === p
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/30 hover:bg-muted/60"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void handleSave()} disabled={saving || !label.trim() || !cronExpr.trim()}>
              {saving && <Loader2Icon className="size-4 animate-spin" />}
              {initial ? "Save changes" : "Create"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── Schedule Row ──────────────────────────────────────────────────────────────

function ScheduleRow({
  sched,
  onToggle,
  onEdit,
  onDelete,
}: {
  sched: ScheduledRun
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="ring-border/40 flex items-center gap-4 px-4 py-3 ring-1">
      <Switch checked={sched.enabled} onCheckedChange={onToggle} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{sched.label}</span>
          <span className="text-muted-foreground font-mono text-xs shrink-0">
            {sched.cron_expr}
          </span>
          <span className="bg-muted/50 ring-border/40 rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 shrink-0">
            {sched.product}
          </span>
        </div>
        <div className="text-muted-foreground mt-0.5 flex gap-3 text-xs">
          <span className="flex items-center gap-1">
            <PlayIcon className="size-3" />
            Last: {formatLast(sched.last_run_at)}
          </span>
          <span className="flex items-center gap-1">
            <ClockIcon className="size-3" />
            Next: {formatNext(sched.next_run_at)}
          </span>
        </div>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button variant="ghost" size="icon" className="size-7" onClick={onEdit}>
          <PencilIcon className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="text-destructive hover:text-destructive size-7"
          onClick={onDelete}
        >
          <TrashIcon className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ScheduledRunsPage() {
  const org = useActiveOrg()
  const [schedules, setSchedules] = useState<ScheduledRun[] | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<ScheduledRun | undefined>()

  const load = useCallback(() => {
    if (!org) return
    scheduledRunsApi
      .list(org.id)
      .then(setSchedules)
      .catch(() => setSchedules([]))
  }, [org?.id])

  useEffect(() => { load() }, [load])

  const handleCreate = async (body: ScheduledRunBody) => {
    if (!org) return
    try {
      await scheduledRunsApi.create(org.id, body)
      toast.success("Schedule created")
      load()
    } catch (err) {
      toast.error(readError(err, "Failed to create schedule"))
      throw err
    }
  }

  const handleUpdate = async (schedId: string, body: ScheduledRunBody) => {
    if (!org) return
    try {
      await scheduledRunsApi.update(org.id, schedId, body)
      toast.success("Schedule updated")
      load()
    } catch (err) {
      toast.error(readError(err, "Failed to update schedule"))
      throw err
    }
  }

  const handleToggle = async (sched: ScheduledRun) => {
    if (!org) return
    try {
      await scheduledRunsApi.toggle(org.id, sched.id)
      setSchedules((prev) =>
        prev ? prev.map((s) => s.id === sched.id ? { ...s, enabled: !s.enabled } : s) : prev
      )
    } catch (err) {
      toast.error(readError(err, "Failed to toggle schedule"))
    }
  }

  const handleDelete = async (schedId: string) => {
    if (!org) return
    try {
      await scheduledRunsApi.delete(org.id, schedId)
      setSchedules((prev) => prev ? prev.filter((s) => s.id !== schedId) : prev)
      toast.success("Schedule deleted")
    } catch (err) {
      toast.error(readError(err, "Failed to delete schedule"))
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Scheduled Runs</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Automatically run tests on a cron schedule. Runs are queued as regular test runs.
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(undefined)
            setDialogOpen(true)
          }}
          disabled={!org}
        >
          <PlusIcon className="size-4" />
          New schedule
        </Button>
      </div>

      {schedules === null ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : schedules.length === 0 ? (
        <div className="ring-border/40 flex flex-col items-center gap-4 py-16 ring-1">
          <CalendarClockIcon className="text-muted-foreground size-10" />
          <div className="text-center">
            <p className="font-medium">No schedules yet</p>
            <p className="text-muted-foreground mt-1 text-sm">
              Create a schedule to automatically run tests at a recurring time.
            </p>
          </div>
          <Button
            onClick={() => {
              setEditing(undefined)
              setDialogOpen(true)
            }}
          >
            <PlusIcon className="size-4" />
            Create first schedule
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {schedules.map((s) => (
            <ScheduleRow
              key={s.id}
              sched={s}
              onToggle={() => void handleToggle(s)}
              onEdit={() => {
                setEditing(s)
                setDialogOpen(true)
              }}
              onDelete={() => void handleDelete(s.id)}
            />
          ))}
        </div>
      )}

      <ScheduleFormDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        initial={editing}
        onSave={
          editing
            ? (body) => handleUpdate(editing.id, body)
            : handleCreate
        }
      />

    </div>
  )
}
