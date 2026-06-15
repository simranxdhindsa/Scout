import { useCallback, useEffect, useState } from "react"
import {
  ArrowRightIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleDotIcon,
  ClockIcon,
  GitMergeIcon,
  Loader2Icon,
  PlayIcon,
  PlusIcon,
  Trash2Icon,
  XCircleIcon,
} from "lucide-react"
import { useNavigate } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { useActiveOrg } from "@/lib/auth"
import {
  flowsApi,
  type Flow,
  type FlowProduct,
  type FlowRun,
  type FlowRunStatus,
  type FlowStep,
} from "@/lib/scout-api"

const statusMeta: Record<FlowRunStatus, { label: string; cls: string; icon: React.ReactNode }> = {
  queued:  { label: "Queued",  cls: "bg-amber-500/10 text-amber-300 ring-amber-500/30",   icon: <ClockIcon className="h-3 w-3" /> },
  running: { label: "Running", cls: "bg-sky-500/10 text-sky-300 ring-sky-500/30",         icon: <Loader2Icon className="h-3 w-3 animate-spin" /> },
  passed:  { label: "Passed",  cls: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30", icon: <CheckCircle2Icon className="h-3 w-3" /> },
  failed:  { label: "Failed",  cls: "bg-rose-500/10 text-rose-300 ring-rose-500/30",      icon: <XCircleIcon className="h-3 w-3" /> },
  stopped: { label: "Stopped", cls: "bg-zinc-500/10 text-zinc-300 ring-zinc-500/30",      icon: <CircleDotIcon className="h-3 w-3" /> },
}

const productColors: Record<FlowProduct, string> = {
  "ui":              "bg-violet-500/10 text-violet-300 border-violet-500/30",
  "mission-control": "bg-blue-500/10 text-blue-300 border-blue-500/30",
  "studio-web":      "bg-amber-500/10 text-amber-300 border-amber-500/30",
}

const productLabels: Record<FlowProduct, string> = {
  "ui":              "UI",
  "mission-control": "Mission Control",
  "studio-web":      "Studio Web",
}

function relativeTime(iso: string) {
  const seconds = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const m = Math.round(seconds / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

function StatusBadge({ status }: { status: FlowRunStatus }) {
  const meta = statusMeta[status] ?? statusMeta.queued
  return (
    <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${meta.cls}`}>
      {meta.icon} {meta.label}
    </span>
  )
}

// ── Create Flow Dialog ────────────────────────────────────────────────────────

function CreateFlowDialog({ orgId, onCreated }: { orgId: string; onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [saving, setSaving] = useState(false)

  async function handleCreate() {
    if (!name.trim()) return
    setSaving(true)
    try {
      await flowsApi.create(orgId, { name: name.trim(), description })
      setOpen(false)
      setName("")
      setDescription("")
      onCreated()
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <PlusIcon className="h-4 w-4 mr-1" /> New Flow
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Cross-Platform Flow</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label htmlFor="flow-name">Name</Label>
              <Input
                id="flow-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Course Creation E2E"
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="flow-desc">Description</Label>
              <Textarea
                id="flow-desc"
                value={description}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value)}
                placeholder="What does this flow test end-to-end?"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={saving || !name.trim()}>
              {saving && <Loader2Icon className="h-4 w-4 mr-1 animate-spin" />}
              Create Flow
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ── Add Step Dialog ───────────────────────────────────────────────────────────

function AddStepDialog({
  orgId,
  flowId,
  position,
  onAdded,
}: {
  orgId: string
  flowId: string
  position: number
  onAdded: () => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [product, setProduct] = useState<FlowProduct>("ui")
  const [saving, setSaving] = useState(false)

  async function handleAdd() {
    if (!name.trim()) return
    setSaving(true)
    try {
      await flowsApi.addStep(orgId, flowId, { name: name.trim(), product, position })
      setOpen(false)
      setName("")
      onAdded()
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 w-full border border-dashed border-border rounded px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:border-border/80 transition-colors"
      >
        <PlusIcon className="h-4 w-4" /> Add step
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Step</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Step Name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Create course in Studio"
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              />
            </div>
            <div className="space-y-1">
              <Label>Product</Label>
              <Select value={product} onValueChange={(v) => setProduct(v as FlowProduct)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="studio-web">Studio Web</SelectItem>
                  <SelectItem value="mission-control">Mission Control</SelectItem>
                  <SelectItem value="ui">UI (Learner)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleAdd} disabled={saving || !name.trim()}>
              {saving && <Loader2Icon className="h-4 w-4 mr-1 animate-spin" />}
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ── Flow Card ─────────────────────────────────────────────────────────────────

function FlowCard({
  flow,
  orgId,
  onDeleted,
  onRun,
}: {
  flow: Flow
  orgId: string
  onDeleted: () => void
  onRun: (flowRunId: string) => void
}) {
  const [steps, setSteps] = useState<FlowStep[] | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [running, setRunning] = useState(false)
  const [deleting, setDeleting] = useState(false)
  useEffect(() => {
    if (expanded && steps === null) {
      flowsApi.get(orgId, flow.id).then((d) => setSteps(d.steps))
    }
  }, [expanded, steps, orgId, flow.id])

  async function handleRun() {
    setRunning(true)
    try {
      const res = await flowsApi.run(orgId, flow.id)
      onRun(res.flow_run_id)
    } finally {
      setRunning(false)
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete flow "${flow.name}"?`)) return
    setDeleting(true)
    try {
      await flowsApi.remove(orgId, flow.id)
      onDeleted()
    } finally {
      setDeleting(false)
    }
  }

  async function handleStepDelete(stepId: string) {
    await flowsApi.removeStep(orgId, flow.id, stepId)
    setSteps((prev) => prev?.filter((s) => s.id !== stepId) ?? null)
  }

  return (
    <div className="border border-border rounded bg-card">
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          className="flex-1 flex items-start gap-3 text-left"
          onClick={() => setExpanded((e) => !e)}
        >
          <GitMergeIcon className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
          <div>
            <div className="font-medium text-sm">{flow.name}</div>
            {flow.description && (
              <div className="text-xs text-muted-foreground mt-0.5">{flow.description}</div>
            )}
          </div>
          <span className="ml-auto text-xs text-muted-foreground">
            {flow.step_count ?? 0} step{flow.step_count === 1 ? "" : "s"}
          </span>
          <ChevronRightIcon
            className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`}
          />
        </button>
        <Button size="sm" variant="outline" onClick={handleRun} disabled={running}>
          {running ? <Loader2Icon className="h-3.5 w-3.5 animate-spin" /> : <PlayIcon className="h-3.5 w-3.5" />}
          Run
        </Button>
        <Button size="sm" variant="ghost" onClick={handleDelete} disabled={deleting} className="text-destructive hover:text-destructive">
          {deleting ? <Loader2Icon className="h-3.5 w-3.5 animate-spin" /> : <Trash2Icon className="h-3.5 w-3.5" />}
        </Button>
      </div>

      {expanded && (
        <div className="border-t border-border px-4 pb-4 pt-3 space-y-2">
          {steps === null ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-3/4" />
            </div>
          ) : steps.length === 0 ? (
            <p className="text-xs text-muted-foreground">No steps yet. Add the first step below.</p>
          ) : (
            <div className="space-y-1">
              {steps.map((step, idx) => (
                <div key={step.id} className="flex items-center gap-2 group">
                  <span className="text-xs text-muted-foreground w-5 text-right shrink-0">{idx + 1}</span>
                  <span className={`text-xs px-2 py-0.5 rounded border ${productColors[step.product]}`}>
                    {productLabels[step.product]}
                  </span>
                  <span className="text-sm flex-1">{step.name}</span>
                  {step.test_case_name && (
                    <span className="text-xs text-muted-foreground truncate max-w-[140px]">{step.test_case_name}</span>
                  )}
                  {idx < steps.length - 1 && (
                    <ArrowRightIcon className="h-3 w-3 text-muted-foreground shrink-0" />
                  )}
                  <button
                    onClick={() => handleStepDelete(step.id)}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                    title="Remove step"
                  >
                    <Trash2Icon className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          {steps !== null && (
            <AddStepDialog
              orgId={orgId}
              flowId={flow.id}
              position={(steps?.length ?? 0) + 1}
              onAdded={() => {
                flowsApi.get(orgId, flow.id).then((d) => setSteps(d.steps))
              }}
            />
          )}
        </div>
      )}
    </div>
  )
}

// ── Flow Runs Table ───────────────────────────────────────────────────────────

function FlowRunsTable({ orgId }: { orgId: string }) {
  const navigate = useNavigate()
  const [runs, setRuns] = useState<FlowRun[] | null>(null)

  useEffect(() => {
    let cancelled = false
    function load() {
      flowsApi.listRuns(orgId, { limit: 10 }).then((d) => {
        if (!cancelled) setRuns(d.runs)
      })
    }
    load()
    const id = setInterval(load, 5000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [orgId])

  if (runs === null) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    )
  }
  if (runs.length === 0) {
    return <p className="text-sm text-muted-foreground">No flow runs yet.</p>
  }

  return (
    <div className="rounded border border-border overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-muted-foreground text-xs uppercase tracking-wide">
            <th className="px-4 py-2 text-left">Flow</th>
            <th className="px-4 py-2 text-left">Status</th>
            <th className="px-4 py-2 text-left">Started</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr
              key={run.id}
              className="border-b border-border last:border-0 hover:bg-muted/30 cursor-pointer transition-colors"
              onClick={() => navigate(`/dashboard/pipeline/runs/${run.id}`)}
            >
              <td className="px-4 py-2.5 font-medium">{run.flow_name ?? run.flow_id.slice(0, 8)}</td>
              <td className="px-4 py-2.5">
                <StatusBadge status={run.status} />
              </td>
              <td className="px-4 py-2.5 text-muted-foreground text-xs">
                {relativeTime(run.created_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function FlowsPage() {
  const navigate = useNavigate()
  const org = useActiveOrg()
  const [flows, setFlows] = useState<Flow[] | null>(null)
  const [tab, setTab] = useState<"flows" | "runs">("flows")

  const loadFlows = useCallback(() => {
    if (!org) return
    flowsApi.list(org.id).then(setFlows)
  }, [org?.id])

  useEffect(() => {
    loadFlows()
  }, [loadFlows])

  if (!org) return null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Cross-Platform Flows</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Chain tests across Studio Web → Mission Control → UI to validate end-to-end journeys
          </p>
        </div>
        <CreateFlowDialog orgId={org.id} onCreated={loadFlows} />
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border">
        {(["flows", "runs"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm capitalize border-b-2 transition-colors ${
              tab === t
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "flows" && (
        <div className="space-y-3">
          {flows === null ? (
            [1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)
          ) : flows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <GitMergeIcon className="h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                No flows yet. Create one to chain tests across products.
              </p>
              <CreateFlowDialog orgId={org.id} onCreated={loadFlows} />
            </div>
          ) : (
            flows.map((flow) => (
              <FlowCard
                key={flow.id}
                flow={flow}
                orgId={org.id}
                onDeleted={loadFlows}
                onRun={(flowRunId) => navigate(`/dashboard/pipeline/runs/${flowRunId}`)}
              />
            ))
          )}
        </div>
      )}

      {tab === "runs" && <FlowRunsTable orgId={org.id} />}
    </div>
  )
}
