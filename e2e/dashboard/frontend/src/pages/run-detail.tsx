import { useEffect, useRef, useState } from "react"
import {
  ArrowLeftIcon,
  CheckCircle2Icon,
  CircleIcon,
  ClapperboardIcon,
  DownloadIcon,
  ExternalLinkIcon,
  ImageIcon,
  Loader2Icon,
  MonitorPlayIcon,
  RefreshCwIcon,
  StopCircleIcon,
  TerminalIcon,
  XCircleIcon,
} from "lucide-react"
import { Link, useNavigate, useParams } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import { useActiveOrg } from "@/lib/auth"
import {
  runStreamUrl,
  runsApi,
  type RunAttachment,
  type RunDetailResponse,
  type RunItem,
  type RunStatus,
  type RunTestResult,
} from "@/lib/scout-api"

type StreamLine = {
  type: "stdout" | "stderr" | "status" | "error" | "done" | "data" | "screenshot"
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
    case "timedOut":
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
  const orgId = useActiveOrg()?.id ?? null
  const navigate = useNavigate()

  const [detail, setDetail] = useState<RunDetailResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stopping, setStopping] = useState(false)
  const [rerunning, setRerunning] = useState(false)
  const [lines, setLines] = useState<StreamLine[]>([])
  const [liveScreenshot, setLiveScreenshot] = useState<string | null>(null)
  const [selectedScreenshot, setSelectedScreenshot] = useState<string | null>(null)

  const inProgress =
    detail?.run.status === "queued" || detail?.run.status === "running"

  // Poll run state every 2 s; self-terminate once run reaches a terminal state.
  useEffect(() => {
    if (!orgId || !runId) return
    let cancelled = false
    let interval: ReturnType<typeof setInterval> | null = null

    const load = async () => {
      try {
        const data = await runsApi.get(orgId, runId)
        if (cancelled) return
        setDetail(data)
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

  // WebSocket stream: stdout/stderr lines + live screenshots while run is active.
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
          if (msg.type === "screenshot") {
            setLiveScreenshot(msg.payload)
            return
          }
          if (msg.type === "done" || msg.type === "error") return
          setLines((prev) => [...prev, msg])
        } catch {
          /* ignore malformed frames */
        }
      }
      sock.onclose = () => {
        if (closedByCleanup) return
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

  const { run, items, report, attachments = [], test_results = [] } = detail
  const screenshots = attachments.filter((a) => a.type === "screenshot")
  const videos = attachments.filter((a) => a.type === "video")
  const traces = attachments.filter((a) => a.type === "trace")

  return (
    <div className="flex flex-col gap-6">
      <BackLink />

      {/* Header: title + status badge + action buttons */}
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
          <p className="text-muted-foreground mt-1 font-mono text-xs">{run.id}</p>
        </div>
        <div className="flex items-center gap-2">
          {inProgress ? (
            <Button variant="outline" size="sm" onClick={handleStop} disabled={stopping}>
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

      {/* Pre-run failure banner */}
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

      {/* Stats row + trace/video quick-action buttons */}
      {report ? (
        <div className="flex flex-wrap items-stretch gap-4">
          <div className="grid flex-1 grid-cols-2 gap-4 md:grid-cols-5">
            <Stat label="Total" value={report.total} />
            <Stat label="Passed" value={report.passed} accent="emerald" />
            <Stat label="Failed" value={report.failed} accent="rose" />
            <Stat label="Skipped" value={report.skipped} />
            <Stat label="Duration" value={formatDuration(report.duration_ms)} />
          </div>
          {(videos.length > 0 || traces.length > 0) && (
            <div className="flex flex-col gap-2">
              {videos.map((v, i) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() =>
                    downloadAttachment(v.storage_url, `recording-${i + 1}.webm`)
                  }
                  className="bg-muted/40 ring-border/40 hover:bg-accent inline-flex items-center gap-2 px-3 py-2 text-xs ring-1 whitespace-nowrap"
                >
                  <ClapperboardIcon className="size-3.5" />
                  Download Video
                </button>
              ))}
              {traces.map((t) => (
                <a
                  key={t.id}
                  href={`https://trace.playwright.dev/?trace=${encodeURIComponent(t.storage_url)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-muted/40 ring-border/40 hover:bg-accent inline-flex items-center gap-2 px-3 py-2 text-xs ring-1 whitespace-nowrap"
                >
                  <ExternalLinkIcon className="size-3.5" />
                  View Trace
                </a>
              ))}
            </div>
          )}
        </div>
      ) : inProgress ? (
        <p className="text-muted-foreground text-sm">
          Run is {run.status}. Results will appear here as tests complete.
        </p>
      ) : null}

      {/* Terminal output + live screenshot preview (side by side while running) */}
      {(lines.length > 0 || inProgress) && (
        <div
          className={
            inProgress && liveScreenshot ? "grid grid-cols-2 gap-4" : undefined
          }
        >
          <TerminalPanel lines={lines} inProgress={!!inProgress} />
          {inProgress && liveScreenshot && <LivePreview src={liveScreenshot} />}
        </div>
      )}

      {/* Screenshot strip — persisted attachments shown after run */}
      {!inProgress && screenshots.length > 0 && (
        <AttachmentStrip
          screenshots={screenshots}
          selected={selectedScreenshot}
          onSelect={setSelectedScreenshot}
        />
      )}

      {/* Inline video player */}
      {!inProgress && videos.length > 0 && (
        <div className="ring-border/40 flex flex-col ring-1">
          <div className="border-border/40 flex items-center gap-2 border-b px-4 py-2 text-xs">
            <MonitorPlayIcon className="size-3.5 text-zinc-400" />
            <span className="font-medium tracking-wider text-zinc-400 uppercase">
              Recording{videos.length > 1 ? `s (${videos.length})` : ""}
            </span>
          </div>
          <div className="flex flex-wrap gap-4 p-4">
            {videos.map((v, i) => (
              <AuthedVideo
                key={v.id}
                storageUrl={v.storage_url}
                className="max-h-64 max-w-full ring-border/40 min-h-32 min-w-48 ring-1"
                title={`Recording ${i + 1}`}
              />
            ))}
          </div>
        </div>
      )}

      {/* Test items list */}
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
          <p className="text-muted-foreground p-6 text-center text-sm">No tests yet.</p>
        ) : (
          <ul className="divide-border/40 divide-y">
            {items.map((it) => (
              <RunItemRow key={it.id} item={it} />
            ))}
          </ul>
        )}
      </div>

      {/* Individual test() breakdown, grouped by spec file */}
      {test_results.length > 0 && (
        <TestResultsBreakdown results={test_results} />
      )}
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────────

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
      <p className="text-muted-foreground text-xs tracking-wider uppercase">{label}</p>
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
        <span className="font-medium tracking-wider text-zinc-400 uppercase">Output</span>
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

function LivePreview({ src }: { src: string }) {
  return (
    <div className="ring-border/40 flex flex-col bg-zinc-950 ring-1">
      <div className="border-border/40 flex items-center gap-2 border-b px-4 py-2 text-xs">
        <MonitorPlayIcon className="size-3.5 text-sky-400" />
        <span className="font-medium tracking-wider text-sky-400 uppercase">
          Live Preview
        </span>
        <span className="ml-auto flex items-center gap-1.5 text-[10px] text-zinc-500">
          <span className="inline-block size-1.5 animate-pulse rounded-full bg-sky-400" />
          live
        </span>
      </div>
      <div className="flex items-center justify-center p-2">
        <img
          src={src}
          alt="Live browser preview"
          className="max-h-[360px] w-full object-contain"
        />
      </div>
    </div>
  )
}

// Storage artifacts are served from an authenticated backend route, so a plain
// <img src> can't load them (no bearer header, cross-origin cookie). Absolute
// (S3) URLs are used as-is; bare local keys are fetched through the axios client
// (which attaches the JWT) and turned into object URLs.
function isAbsoluteUrl(u: string) {
  return /^https?:\/\//i.test(u)
}

function storageKey(storageUrl: string) {
  return storageUrl
    .replace(/^\/?(api\/v1\/storage\/)/, "")
    .replace(/^\/+/, "")
}

async function fetchAttachmentObjectUrl(storageUrl: string): Promise<string> {
  if (isAbsoluteUrl(storageUrl)) return storageUrl
  const res = await api.get(`/storage/${storageKey(storageUrl)}`, {
    responseType: "blob",
  })
  return URL.createObjectURL(res.data as Blob)
}

function useAuthedBlob(storageUrl: string) {
  const [url, setUrl] = useState<string | null>(
    isAbsoluteUrl(storageUrl) ? storageUrl : null,
  )
  useEffect(() => {
    if (isAbsoluteUrl(storageUrl)) {
      setUrl(storageUrl)
      return
    }
    let objectUrl: string | null = null
    let cancelled = false
    fetchAttachmentObjectUrl(storageUrl)
      .then((u) => {
        if (cancelled) {
          URL.revokeObjectURL(u)
          return
        }
        objectUrl = u
        setUrl(u)
      })
      .catch(() => {
        /* leave as null → broken-image fallback */
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [storageUrl])
  return url
}

function AuthedImage({
  storageUrl,
  alt,
  className,
}: {
  storageUrl: string
  alt: string
  className?: string
}) {
  const url = useAuthedBlob(storageUrl)
  if (!url) {
    return (
      <div
        className={`bg-muted/40 flex items-center justify-center ${className ?? ""}`}
      >
        <Loader2Icon className="text-muted-foreground size-4 animate-spin" />
      </div>
    )
  }
  return <img src={url} alt={alt} className={className} />
}

function AuthedVideo({
  storageUrl,
  className,
  title,
}: {
  storageUrl: string
  className?: string
  title?: string
}) {
  const url = useAuthedBlob(storageUrl)
  if (!url) {
    return (
      <div
        className={`bg-muted/40 flex items-center justify-center ${className ?? ""}`}
      >
        <Loader2Icon className="text-muted-foreground size-5 animate-spin" />
      </div>
    )
  }
  return <video src={url} controls className={className} title={title} />
}

async function downloadAttachment(storageUrl: string, filename: string) {
  try {
    const url = await fetchAttachmentObjectUrl(storageUrl)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    if (!isAbsoluteUrl(storageUrl)) {
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    }
  } catch {
    /* ignore — download just won't start */
  }
}

function AttachmentStrip({
  screenshots,
  selected,
  onSelect,
}: {
  screenshots: RunAttachment[]
  selected: string | null
  onSelect: (url: string | null) => void
}) {
  return (
    <div className="ring-border/40 flex flex-col ring-1">
      <div className="border-border/40 flex items-center gap-2 border-b px-4 py-2 text-xs">
        <ImageIcon className="size-3.5 text-zinc-400" />
        <span className="font-medium tracking-wider text-zinc-400 uppercase">
          Screenshots ({screenshots.length})
        </span>
      </div>

      {/* Expanded view of the selected screenshot */}
      {selected && (
        <div className="border-border/40 relative border-b bg-zinc-950 p-4">
          <AuthedImage
            storageUrl={selected}
            alt="Screenshot"
            className="mx-auto max-h-[480px] max-w-full object-contain"
          />
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="bg-muted/60 ring-border/40 hover:bg-accent absolute top-3 right-3 px-2 py-1 text-xs ring-1"
          >
            Close
          </button>
        </div>
      )}

      {/* Thumbnail strip */}
      <div className="flex flex-wrap gap-3 p-4">
        {screenshots.map((s, i) => (
          <div key={s.id} className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() =>
                onSelect(selected === s.storage_url ? null : s.storage_url)
              }
              className={`ring-1 transition ${
                selected === s.storage_url
                  ? "ring-sky-400"
                  : "ring-border/40 hover:ring-sky-400/50"
              }`}
            >
              <AuthedImage
                storageUrl={s.storage_url}
                alt="Screenshot thumbnail"
                className="h-24 w-40 object-cover"
              />
            </button>
            <button
              type="button"
              onClick={() =>
                downloadAttachment(s.storage_url, `screenshot-${i + 1}.png`)
              }
              className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-[10px]"
            >
              <DownloadIcon className="size-3" />
              Download
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function TestResultsBreakdown({ results }: { results: RunTestResult[] }) {
  // Group individual test() results by their spec file, preserving order.
  const groups: { file: string; tests: RunTestResult[] }[] = []
  const byFile = new Map<string, RunTestResult[]>()
  for (const tr of results) {
    const key = tr.file_name || "—"
    let bucket = byFile.get(key)
    if (!bucket) {
      bucket = []
      byFile.set(key, bucket)
      groups.push({ file: key, tests: bucket })
    }
    bucket.push(tr)
  }

  const isFail = (s: string) => s === "failed" || s === "timedOut"

  return (
    <div className="bg-muted/30 ring-border/40 flex flex-col ring-1">
      <div className="border-border/40 flex items-center justify-between border-b px-4 py-2 text-xs">
        <span className="text-muted-foreground font-medium tracking-wider uppercase">
          Test breakdown
        </span>
        <span className="text-muted-foreground">
          {results.length} {results.length === 1 ? "test" : "tests"}
        </span>
      </div>
      <div className="divide-border/40 divide-y">
        {groups.map((g) => {
          const failed = g.tests.filter((t) => isFail(t.status)).length
          const passed = g.tests.filter((t) => t.status === "passed").length
          return (
            <div key={g.file} className="flex flex-col">
              <div className="bg-muted/20 flex items-center gap-2 px-4 py-1.5">
                <span className="flex-1 truncate font-mono text-xs font-medium">
                  {g.file}
                </span>
                {failed > 0 ? (
                  <span className="text-rose-400 text-[10px] font-medium">
                    {failed} failed
                  </span>
                ) : null}
                {passed > 0 ? (
                  <span className="text-emerald-400 text-[10px] font-medium">
                    {passed} passed
                  </span>
                ) : null}
              </div>
              <ul className="divide-border/40 divide-y">
                {g.tests.map((t) => (
                  <TestResultRow key={t.id} test={t} />
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TestResultRow({ test }: { test: RunTestResult }) {
  const [open, setOpen] = useState(false)
  const hasDetail = !!(test.error_message || test.error_stack)
  return (
    <li>
      <button
        type="button"
        onClick={() => hasDetail && setOpen((v) => !v)}
        className={`flex w-full items-center gap-3 py-2 pr-4 pl-8 text-left text-sm ${
          hasDetail ? "hover:bg-muted/40 cursor-pointer" : "cursor-default"
        }`}
      >
        {itemIcon(test.status)}
        <span className="flex-1 truncate text-xs">
          {test.title || "(untitled test)"}
        </span>
        {test.retry_count > 0 ? (
          <span className="text-amber-400 text-[10px]">
            {test.retry_count} {test.retry_count === 1 ? "retry" : "retries"}
          </span>
        ) : null}
        <span className="text-muted-foreground text-xs">
          {formatDuration(test.duration_ms)}
        </span>
      </button>
      {open && hasDetail ? (
        <div className="bg-muted/20 border-border/40 border-t px-8 py-3">
          {test.error_message ? (
            <pre className="text-destructive text-xs whitespace-pre-wrap">
              {test.error_message}
            </pre>
          ) : null}
          {test.error_stack ? (
            <pre className="text-muted-foreground mt-2 text-xs whitespace-pre-wrap">
              {test.error_stack}
            </pre>
          ) : null}
        </div>
      ) : null}
    </li>
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
