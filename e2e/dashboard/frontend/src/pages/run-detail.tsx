import { useEffect, useRef, useState } from "react"
import {
  ArrowLeftIcon,
  CheckCircle2Icon,
  CircleIcon,
  Loader2Icon,
  RefreshCwIcon,
  StopCircleIcon,
  TerminalIcon,
  XCircleIcon,
} from "lucide-react"
import { Link, useNavigate, useParams } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { useAuthStore } from "@/lib/auth"
import {
  runStreamUrl,
  runsApi,
  type RunDetailResponse,
  type RunItem,
  type RunStatus,
} from "@/lib/scout-api"

type StreamLine = {
  type: "stdout" | "stderr" | "status" | "error" | "done" | "data"
  payload: string
}

const statusClass: Record<RunStatus, string> = {
  failed: "bg-rose-500/10 text-rose-300 ring-rose-500/30",
  done: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30",
  running: "bg-sky-500/10 text-sky-300 ring-sky-500/30",
  queued: "bg-amber-500/10 text-amber-300 ring-amber-500/30",
  stopped: "bg-zinc-500/10 text-zinc-300 ring-zinc-500/30",
}

function readError(err: unknown, fallback: string) {
  return (
    (err as { response?: { data?: { error?: string } } })?.response?.data
      ?.error ?? fallback
  )
}

function formatDuration(ms: number | null | undefined) {
  if (ms == null) return "—"
  if (ms < 1000) return `${ms}ms`
  const seconds = Math.round(ms / 100) / 10
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rem = Math.round(seconds % 60)
  return rem ? `${minutes}m ${rem}s` : `${minutes}m`
}

function itemIcon(status: string) {
  switch (status) {
    case "passed":
      return <CheckCircle2Icon className="size-4 text-emerald-400" />
    case "failed":
    case "timed_out":
      return <XCircleIcon className="size-4 text-rose-400" />
    case "running":
      return <Loader2Icon className="size-4 animate-spin text-sky-400" />
    case "skipped":
      return <CircleIcon className="size-4 text-zinc-500" />
    default:
      return <CircleIcon className="size-4 text-muted-foreground" />
  }
}

export default function RunDetailPage() {
  const { runId } = useParams<{ runId: string }>()
  const orgId = useAuthStore((s) => s.orgs[0]?.id ?? null)
  const navigate = useNavigate()

  const [detail, setDetail] = useState<RunDetailResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stopping, setStopping] = useState(false)
  const [rerunning, setRerunning] = useState(false)
  const [lines, setLines] = useState<StreamLine[]>([])

  const inProgress =
    detail?.run.status === "queued" || detail?.run.status === "running"

  useEffect(() => {
    if (!orgId || !runId) return
    let cancelled = false
    let interval: ReturnType<typeof setInterval> | null = null

    const load = async () => {
      try {
        const data = await runsApi.get(orgId, runId)
        if (cancelled) return
        setDetail(data)
        // Self-terminating poll: once the run reaches a terminal state, stop
        // hammering the API. We intentionally don't depend on `detail` in the
        // effect deps — that would re-fire the effect on every setDetail and
        // turn polling into a request-per-render loop.
        if (
          data.run.status !== "queued" &&
          data.run.status !== "running" &&
          interval
        ) {
          clearInterval(interval)
          interval = null
        }
      } catch (err) {
        if (!cancelled) setError(readError(err, "Failed to load run"))
      }
    }

    load()
    interval = setInterval(load, 2000)
    return () => {
      cancelled = true
      if (interval) clearInterval(interval)
    }
  }, [orgId, runId])

  // Tap the run's stdout/stderr/status stream while it's in progress.
  // We depend on the actual status string (not just `inProgress`) so the
  // effect re-fires on queued → running, and we retry the socket if it
  // closes while the run is still active (e.g. opened before the worker
  // picked up the job, when the hub didn't yet exist server-side).
  const status = detail?.run.status
  useEffect(() => {
    if (!orgId || !runId) return
    if (status !== "queued" && status !== "running") return

    let closedByCleanup = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let ws: WebSocket | null = null

    const connect = () => {
      const sock = new WebSocket(runStreamUrl(orgId, runId))
      ws = sock
      sock.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data) as StreamLine
          // Server sends an "error" frame + closes when the hub doesn't
          // exist yet; don't surface that as a real line.
          if (msg.type === "done" || msg.type === "error") return
          setLines((prev) => [...prev, msg])
        } catch {
          /* ignore malformed frames */
        }
      }
      sock.onclose = () => {
        if (closedByCleanup) return
        // Run is still active → reconnect after a short backoff.
        retryTimer = setTimeout(connect, 1000)
      }
    }

    connect()

    return () => {
      closedByCleanup = true
      if (retryTimer) clearTimeout(retryTimer)
      ws?.close()
    }
  }, [orgId, runId, status])

  const handleStop = async () => {
    if (!orgId || !runId) return
    setStopping(true)
    try {
      await runsApi.stop(orgId, runId)
    } catch (err) {
      setError(readError(err, "Failed to stop run"))
    } finally {
      setStopping(false)
    }
  }

  const handleRerun = async () => {
    if (!orgId || !detail) return
    const testCaseIds = detail.items
      .map((it) => it.test_case_id)
      .filter((id): id is string => !!id)
    if (testCaseIds.length === 0) {
      setError("This run has no test cases to re-run.")
      return
    }
    setRerunning(true)
    setError(null)
    try {
      const { run_id } = await runsApi.start(orgId, {
        target_type: "test_case",
        target_ids: testCaseIds,
        environment_id: detail.run.environment_id ?? undefined,
        label: detail.run.label
          ? `Re-run: ${detail.run.label.replace(/^(Re-run:\s*)+/, "")}`
          : "Re-run",
      })
      navigate(`/runs/${run_id}`)
    } catch (err) {
      setError(readError(err, "Failed to re-run"))
    } finally {
      setRerunning(false)
    }
  }

  if (!detail) {
    return (
      <div className="flex flex-col gap-6">
        <BackLink />
        {error ? (
          <p className="text-destructive text-sm">{error}</p>
        ) : (
          <div className="ring-border/40 flex min-h-[40vh] items-center justify-center ring-1">
            <Loader2Icon className="text-muted-foreground size-5 animate-spin" />
          </div>
        )}
      </div>
    )
  }

  const { run, items, report } = detail

  return (
    <div className="flex flex-col gap-6">
      <BackLink />

      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">
              {run.label || "Run"}
            </h1>
            <span
              className={`px-2 py-1 text-[10px] font-medium tracking-wider uppercase ring-1 ${statusClass[run.status]}`}
            >
              {run.status}
            </span>
          </div>
          <p className="text-muted-foreground mt-1 font-mono text-xs">
            {run.id}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {inProgress ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleStop}
              disabled={stopping}
            >
              {stopping ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <StopCircleIcon className="size-4" />
              )}
              Stop
            </Button>
          ) : (
            <Button size="sm" onClick={handleRerun} disabled={rerunning}>
              {rerunning ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <RefreshCwIcon className="size-4" />
              )}
              {rerunning ? "Starting…" : "Re-run"}
            </Button>
          )}
        </div>
      </div>

      {error ? <p className="text-destructive text-sm">{error}</p> : null}

      {run.error_message ? (
        <div className="ring-rose-500/30 bg-rose-500/5 flex flex-col gap-2 p-4 ring-1">
          <div className="flex items-center gap-2">
            <XCircleIcon className="text-rose-400 size-4 shrink-0" />
            <p className="text-rose-300 text-sm font-semibold">
              Run failed before tests could complete
            </p>
          </div>
          <pre className="text-rose-200 overflow-x-auto text-xs whitespace-pre-wrap">
            {run.error_message}
          </pre>
        </div>
      ) : null}

      {report ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          <Stat label="Total" value={report.total} />
          <Stat label="Passed" value={report.passed} accent="emerald" />
          <Stat label="Failed" value={report.failed} accent="rose" />
          <Stat label="Skipped" value={report.skipped} />
          <Stat label="Duration" value={formatDuration(report.duration_ms)} />
        </div>
      ) : inProgress ? (
        <p className="text-muted-foreground text-sm">
          Run is {run.status}. Results will appear here as tests complete.
        </p>
      ) : null}

      {lines.length > 0 || inProgress ? (
        <TerminalPanel lines={lines} inProgress={inProgress} />
      ) : null}

      <div className="bg-muted/30 ring-border/40 flex flex-col ring-1">
        <div className="border-border/40 flex items-center justify-between border-b px-4 py-2 text-xs">
          <span className="text-muted-foreground font-medium tracking-wider uppercase">
            Tests
          </span>
          <span className="text-muted-foreground">
            {items.length} {items.length === 1 ? "test" : "tests"}
          </span>
        </div>
        {items.length === 0 ? (
          <p className="text-muted-foreground p-6 text-center text-sm">
            No tests yet.
          </p>
        ) : (
          <ul className="divide-border/40 divide-y">
            {items.map((it) => (
              <RunItemRow key={it.id} item={it} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function BackLink() {
  return (
    <Button asChild variant="ghost" size="sm" className="w-fit">
      <Link to="/dashboard/runs">
        <ArrowLeftIcon className="size-4" />
        Back to runs
      </Link>
    </Button>
  )
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string
  value: number | string
  accent?: "emerald" | "rose"
}) {
  const accentClass =
    accent === "emerald"
      ? "text-emerald-400"
      : accent === "rose"
        ? "text-rose-400"
        : "text-foreground"
  return (
    <div className="bg-muted/30 ring-border/40 p-4 ring-1">
      <p className="text-muted-foreground text-xs tracking-wider uppercase">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-semibold ${accentClass}`}>{value}</p>
    </div>
  )
}

function TerminalPanel({
  lines,
  inProgress,
}: {
  lines: StreamLine[]
  inProgress: boolean
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines])

  return (
    <div className="ring-border/40 flex flex-col bg-zinc-950 ring-1">
      <div className="border-border/40 flex items-center gap-2 border-b px-4 py-2 text-xs">
        <TerminalIcon className="size-3.5 text-zinc-400" />
        <span className="font-medium tracking-wider text-zinc-400 uppercase">
          Output
        </span>
        <span className="ml-auto font-mono text-[10px] text-zinc-500">
          {lines.length} {lines.length === 1 ? "line" : "lines"}
        </span>
      </div>
      <div
        ref={scrollRef}
        className="max-h-96 overflow-auto p-3 font-mono text-xs leading-5"
      >
        {lines.length === 0 && inProgress ? (
          <div className="flex items-center gap-2 text-zinc-500">
            <Loader2Icon className="size-3.5 animate-spin" />
            Waiting for output…
          </div>
        ) : null}
        {lines.map((line, i) => (
          <div
            key={i}
            className={
              line.type === "stderr" || line.type === "error"
                ? "whitespace-pre-wrap text-rose-300"
                : line.type === "status"
                  ? "whitespace-pre-wrap text-sky-300"
                  : "whitespace-pre-wrap text-zinc-200"
            }
          >
            {line.payload || " "}
          </div>
        ))}
      </div>
    </div>
  )
}

function RunItemRow({ item }: { item: RunItem }) {
  const [open, setOpen] = useState(false)
  const hasDetail = !!(item.error_message || item.error_stack)
  return (
    <li>
      <button
        type="button"
        onClick={() => hasDetail && setOpen((v) => !v)}
        className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm ${
          hasDetail ? "hover:bg-muted/40 cursor-pointer" : "cursor-default"
        }`}
      >
        {itemIcon(item.status)}
        <span className="flex-1 truncate font-mono text-xs">
          {item.test_case_name || item.test_case_id || "—"}
        </span>
        <span className="text-muted-foreground text-xs">
          {formatDuration(item.duration_ms)}
        </span>
      </button>
      {open && hasDetail ? (
        <div className="bg-muted/20 border-border/40 border-t px-4 py-3">
          {item.error_message ? (
            <pre className="text-destructive text-xs whitespace-pre-wrap">
              {item.error_message}
            </pre>
          ) : null}
          {item.error_stack ? (
            <pre className="text-muted-foreground mt-2 text-xs whitespace-pre-wrap">
              {item.error_stack}
            </pre>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}
