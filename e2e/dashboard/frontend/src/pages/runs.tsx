import { useCallback, useEffect, useState } from "react"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  Loader2Icon,
  PlusIcon,
  RotateCwIcon,
  SearchIcon,
  StopCircleIcon,
} from "lucide-react"
import { useNavigate } from "react-router-dom"

import { NewRunDialog } from "@/components/dialogs/new-run-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { useActiveOrg } from "@/lib/auth"
import {
  runsApi,
  type Run,
  type RunStatus,
} from "@/lib/scout-api"

const PAGE_SIZE = 20

const filters: { key: "all" | RunStatus; label: string }[] = [
  { key: "all", label: "All" },
  { key: "running", label: "Running" },
  { key: "done", label: "Done" },
  { key: "failed", label: "Failed" },
  { key: "queued", label: "Queued" },
  { key: "stopped", label: "Stopped" },
]

const statusClass: Record<RunStatus, string> = {
  failed: "bg-rose-500/10 text-rose-300 ring-rose-500/30",
  done: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30",
  running: "bg-sky-500/10 text-sky-300 ring-sky-500/30",
  queued: "bg-amber-500/10 text-amber-300 ring-amber-500/30",
  stopped: "bg-zinc-500/10 text-zinc-300 ring-zinc-500/30",
}

function relativeTime(iso: string) {
  const then = new Date(iso).getTime()
  const seconds = Math.max(1, Math.round((Date.now() - then) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60)
    return `about ${minutes} minute${minutes === 1 ? "" : "s"} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `about ${hours} hour${hours === 1 ? "" : "s"} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? "" : "s"} ago`
}

function formatDuration(run: Run) {
  if (!run.started_at) return "—"
  const start = new Date(run.started_at).getTime()
  const end = run.completed_at ? new Date(run.completed_at).getTime() : null
  if (end === null) return "Running…"
  const seconds = Math.max(0, Math.round((end - start) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rem = seconds % 60
  if (minutes < 60) return rem ? `${minutes}m ${rem}s` : `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

export default function RunsPage() {
  const navigate = useNavigate()
  const org = useActiveOrg()
  const [active, setActiveFilter] =
    useState<(typeof filters)[number]["key"]>("all")
  const [page, setPage] = useState(0)
  const [runs, setRuns] = useState<Run[] | null>(null)
  const [activeCount, setActiveCount] = useState(0)
  const [total, setTotal] = useState(0)
  const [stoppingId, setStoppingId] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [search, setSearch] = useState("")
  const [newRunOpen, setNewRunOpen] = useState(false)

  // Reset to first page whenever the filter changes.
  useEffect(() => {
    setPage(0)
  }, [active])

  const load = useCallback(
    async (orgId: string, showSpinner = false) => {
      if (showSpinner) setRefreshing(true)
      try {
        const data = await runsApi.list(orgId, {
          status: active === "all" ? undefined : active,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        })
        setRuns(data.runs)
        setActiveCount(data.active)
        setTotal(data.total)
      } finally {
        if (showSpinner) setRefreshing(false)
      }
    },
    [active, page],
  )

  useEffect(() => {
    if (!org) return
    let cancelled = false

    const fire = () => {
      if (cancelled) return
      load(org.id).catch(() => {})
    }
    fire()
    const interval = window.setInterval(fire, 8_000)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [org, load])

  const handleStop = async (runId: string) => {
    if (!org) return
    setStoppingId(runId)
    try {
      await runsApi.stop(org.id, runId)
      await load(org.id)
    } finally {
      setStoppingId(null)
    }
  }

  const visibleRuns = runs === null ? null : runs.filter((r) =>
    !search.trim() ||
    r.label.toLowerCase().includes(search.toLowerCase()) ||
    r.id.toLowerCase().includes(search.toLowerCase()) ||
    (r.environment_name ?? "").toLowerCase().includes(search.toLowerCase())
  )

  const start = total === 0 ? 0 : page * PAGE_SIZE + 1
  const end = Math.min(total, (page + 1) * PAGE_SIZE)
  const canPrev = page > 0
  const canNext = end < total

  return (
    <div className="flex flex-col gap-6">
      {org && (
        <NewRunDialog
          open={newRunOpen}
          onOpenChange={setNewRunOpen}
          orgId={org.id}
        />
      )}

      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">Runs</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => org && load(org.id, true)}
            disabled={!org || refreshing}
            className="bg-muted/60 ring-border/40 hover:bg-accent inline-flex size-9 items-center justify-center ring-1 disabled:opacity-50"
            aria-label="Refresh"
          >
            <RotateCwIcon
              className={`size-4 ${refreshing ? "animate-spin" : ""}`}
            />
          </button>
          <div className="relative">
            <SearchIcon className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              placeholder="Search runs..."
              className="bg-muted/60 w-64 pl-9"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(0) }}
            />
          </div>
          <Button
            size="sm"
            onClick={() => setNewRunOpen(true)}
            disabled={!org}
          >
            <PlusIcon className="size-4" />
            New Run
          </Button>
        </div>
      </div>

      {activeCount > 0 ? (
        <div className="bg-sky-500/10 ring-sky-500/30 text-sky-200 flex items-center gap-2 px-4 py-2 text-sm ring-1">
          <Loader2Icon className="size-4 animate-spin" />
          {activeCount} run{activeCount === 1 ? "" : "s"} in progress
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setActiveFilter(f.key)}
            className={`px-4 py-1.5 text-sm transition ${
              active === f.key
                ? "bg-primary/20 text-primary ring-primary/40 ring-1"
                : "bg-muted/40 text-muted-foreground hover:text-foreground"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="ring-border/40 ring-1">
        <div className="text-muted-foreground bg-muted/30 grid grid-cols-[120px_1fr_1fr_1fr_120px_100px] px-4 py-3 text-[11px] font-medium tracking-wider uppercase">
          <div>Status</div>
          <div>Run</div>
          <div>Environment</div>
          <div>Started</div>
          <div>Duration</div>
          <div className="text-right">Actions</div>
        </div>

        {visibleRuns === null ? (
          <ul>
            {Array.from({ length: 6 }).map((_, i) => (
              <li
                key={i}
                className="border-border/40 grid grid-cols-[120px_1fr_1fr_1fr_120px_100px] items-center border-t px-4 py-4"
              >
                <Skeleton className="h-5 w-16" />
                <div className="flex flex-col gap-1.5">
                  <Skeleton className="h-3.5 w-40" />
                  <Skeleton className="h-3 w-16" />
                </div>
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-3.5 w-12" />
                <Skeleton className="ml-auto h-8 w-16" />
              </li>
            ))}
          </ul>
        ) : visibleRuns.length === 0 ? (
          <div className="text-muted-foreground border-border/40 border-t px-4 py-10 text-center text-sm">
            {search ? "No runs match your search." : "No runs match this filter."}
          </div>
        ) : (
          <ul>
            {visibleRuns.map((r) => {
              const canStop = r.status === "running" || r.status === "queued"
              return (
                <li
                  key={r.id}
                  className="border-border/40 hover:bg-muted/20 grid cursor-pointer grid-cols-[120px_1fr_1fr_1fr_120px_100px] items-center border-t px-4 py-4 transition"
                  onClick={() => navigate(`/runs/${r.id}`)}
                >
                  <div>
                    <span
                      className={`px-2 py-1 text-[10px] font-medium tracking-wider uppercase ring-1 ${statusClass[r.status]}`}
                    >
                      {r.status}
                    </span>
                  </div>
                  <div>
                    <div className="text-sm">{r.label}</div>
                    <div className="text-muted-foreground font-mono text-xs">
                      {r.id.slice(0, 8)}
                    </div>
                  </div>
                  <div className="text-muted-foreground text-sm">
                    {r.environment_name || "—"}
                  </div>
                  <div className="text-sm">
                    {relativeTime(r.started_at ?? r.created_at)}
                  </div>
                  <div className="text-sm">{formatDuration(r)}</div>
                  <div
                    className="flex justify-end"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {canStop ? (
                      <button
                        type="button"
                        disabled={stoppingId === r.id}
                        onClick={() => handleStop(r.id)}
                        className="bg-rose-500/10 ring-rose-500/30 hover:bg-rose-500/20 text-rose-300 inline-flex items-center gap-1 px-3 py-1.5 text-xs ring-1 disabled:opacity-50"
                      >
                        {stoppingId === r.id ? (
                          <Loader2Icon className="size-3 animate-spin" />
                        ) : (
                          <StopCircleIcon className="size-3" />
                        )}
                        Stop
                      </button>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        <div className="border-border/40 text-muted-foreground flex items-center justify-between border-t px-4 py-3 text-xs">
          <span>
            {total === 0 ? "0 runs" : `${start}–${end} of ${total}`}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={!canPrev}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="bg-muted/40 ring-border/40 hover:bg-accent inline-flex size-8 items-center justify-center ring-1 disabled:opacity-40"
              aria-label="Previous"
            >
              <ChevronLeftIcon className="size-4" />
            </button>
            <button
              type="button"
              disabled={!canNext}
              onClick={() => setPage((p) => p + 1)}
              className="bg-muted/40 ring-border/40 hover:bg-accent inline-flex size-8 items-center justify-center ring-1 disabled:opacity-40"
              aria-label="Next"
            >
              <ChevronRightIcon className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
