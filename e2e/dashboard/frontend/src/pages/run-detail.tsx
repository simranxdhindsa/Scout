import { useEffect, useRef, useState } from "react"
import {
  ArrowLeftIcon,
  CheckCircle2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleIcon,
  ClapperboardIcon,
  DownloadIcon,
  ExternalLinkIcon,
  ImageIcon,
  Loader2Icon,
  Maximize2Icon,
  MonitorPlayIcon,
  RefreshCwIcon,
  StopCircleIcon,
  TerminalIcon,
  XCircleIcon,
  XIcon,
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
            <Button variant="destructive" size="sm" onClick={handleStop} disabled={stopping}>
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
          Test cases are running. Results will appear here as tests complete.
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

      {/* Screenshot gallery — persisted attachments grouped by test case */}
      {!inProgress && screenshots.length > 0 && (
        <ScreenshotGallery screenshots={screenshots} items={items} />
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

// One screenshot flattened with the test-case context it belongs to. The flat
// order (grouped, but a single sequence) is what the lightbox steps through.
type GalleryShot = {
  att: RunAttachment
  label: string
  spec?: string
  status?: string
  index: number
}

function ScreenshotGallery({
  screenshots,
  items,
}: {
  screenshots: RunAttachment[]
  items: RunItem[]
}) {
  // Lightbox tracks the active screenshot by its index into the flat list so it
  // can page through every shot regardless of which test group it sits in.
  const [active, setActive] = useState<number | null>(null)

  // Each screenshot carries the individual test() title that produced it (and
  // the run_item_id of its owning spec). Group by the specific test case so
  // users see which test each screenshot belongs to — not just the spec file —
  // falling back to the spec name, then "Unmatched", when no title is present
  // (e.g. older runs created before titles were recorded). Attachment order is
  // preserved both within and across groups.
  const itemById = new Map(items.map((it) => [it.id, it]))
  const groups: {
    key: string
    label: string
    spec?: string
    status?: string
    shots: GalleryShot[]
  }[] = []
  const byKey = new Map<string, (typeof groups)[number]>()
  const flat: GalleryShot[] = []
  for (const att of screenshots) {
    const item = att.run_item_id ? itemById.get(att.run_item_id) : undefined
    const spec = item?.test_case_name || item?.test_case_id || undefined
    const title = att.title?.trim()
    // Distinct test cases can live in the same spec, so the key must include the
    // title; only fall back to the spec/item when there's no title.
    const key = title
      ? `${att.run_item_id || ""}::${title}`
      : att.run_item_id || "__unmatched__"
    const shot: GalleryShot = {
      att,
      label: title || spec || "Unmatched",
      spec: title ? spec : undefined,
      status: item?.status,
      index: flat.length,
    }
    flat.push(shot)
    let group = byKey.get(key)
    if (!group) {
      group = { key, label: shot.label, spec: shot.spec, status: shot.status, shots: [] }
      byKey.set(key, group)
      groups.push(group)
    }
    group.shots.push(shot)
  }

  return (
    <section className="ring-border/40 flex flex-col ring-1">
      <div className="border-border/40 flex items-center gap-2 border-b px-4 py-2.5 text-xs">
        <ImageIcon className="size-3.5 text-zinc-400" />
        <span className="font-medium tracking-wider text-zinc-400 uppercase">
          Screenshots
        </span>
        <span className="bg-muted/60 text-muted-foreground ml-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums">
          {screenshots.length}
        </span>
      </div>

      <div className="divide-border/40 flex flex-col divide-y">
        {groups.map((g) => (
          <div key={g.key} className="flex flex-col gap-3 p-4">
            {/* Test-case header */}
            <div className="flex items-center gap-2">
              {g.status ? itemIcon(g.status) : null}
              <span className="truncate text-sm font-medium">{g.label}</span>
              {g.spec ? (
                <span className="text-muted-foreground/70 truncate font-mono text-[10px]">
                  {g.spec}
                </span>
              ) : null}
              <span className="text-muted-foreground ml-auto shrink-0 text-[10px] tabular-nums">
                {g.shots.length} {g.shots.length === 1 ? "shot" : "shots"}
              </span>
            </div>

            {/* Responsive thumbnail grid */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
              {g.shots.map((shot) => (
                <Thumbnail
                  key={shot.att.id}
                  shot={shot}
                  onOpen={() => setActive(shot.index)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {active != null && flat[active] && (
        <Lightbox
          shots={flat}
          index={active}
          onIndexChange={setActive}
          onClose={() => setActive(null)}
        />
      )}
    </section>
  )
}

function Thumbnail({
  shot,
  onOpen,
}: {
  shot: GalleryShot
  onOpen: () => void
}) {
  return (
    <div className="group/thumb ring-border/40 hover:ring-primary/60 focus-within:ring-primary relative aspect-video overflow-hidden ring-1 transition">
      <button
        type="button"
        onClick={onOpen}
        className="block size-full cursor-zoom-in outline-none"
        aria-label={`Open screenshot from ${shot.label}`}
      >
        <AuthedImage
          storageUrl={shot.att.storage_url}
          alt={`Screenshot from ${shot.label}`}
          className="size-full object-cover transition duration-200 group-hover/thumb:scale-[1.03]"
        />
        {/* Hover scrim + zoom affordance */}
        <span className="absolute inset-0 flex items-center justify-center bg-zinc-950/0 opacity-0 transition group-hover/thumb:bg-zinc-950/30 group-hover/thumb:opacity-100">
          <Maximize2Icon className="size-5 text-white drop-shadow" />
        </span>
      </button>
      {/* Download — top-right, revealed on hover */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          downloadAttachment(shot.att.storage_url, `screenshot-${shot.index + 1}.png`)
        }}
        title="Download screenshot"
        className="bg-zinc-950/60 absolute top-1.5 right-1.5 p-1.5 text-white opacity-0 backdrop-blur-sm transition hover:bg-zinc-950/80 focus:opacity-100 group-hover/thumb:opacity-100"
      >
        <DownloadIcon className="size-3.5" />
      </button>
    </div>
  )
}

function Lightbox({
  shots,
  index,
  onIndexChange,
  onClose,
}: {
  shots: GalleryShot[]
  index: number
  onIndexChange: (i: number) => void
  onClose: () => void
}) {
  const shot = shots[index]
  const count = shots.length

  // Keyboard navigation: Esc closes, ←/→ page through. Re-bound when index
  // changes so the handlers close over the current position.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
      else if (e.key === "ArrowRight") onIndexChange((index + 1) % count)
      else if (e.key === "ArrowLeft") onIndexChange((index - 1 + count) % count)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [index, count, onClose, onIndexChange])

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-zinc-950/90 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Screenshot viewer"
    >
      {/* Top bar: caption + counter + close */}
      <div
        className="flex items-center gap-3 px-4 py-3 text-sm text-zinc-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex min-w-0 flex-col">
          <span className="flex items-center gap-2 truncate font-medium">
            {shot.status ? itemIcon(shot.status) : null}
            {shot.label}
          </span>
          {shot.spec ? (
            <span className="truncate font-mono text-[10px] text-zinc-400">
              {shot.spec}
            </span>
          ) : null}
        </div>
        <span className="ml-auto shrink-0 text-xs text-zinc-400 tabular-nums">
          {index + 1} / {count}
        </span>
        <button
          type="button"
          onClick={() =>
            downloadAttachment(shot.att.storage_url, `screenshot-${index + 1}.png`)
          }
          title="Download"
          className="ring-border/30 hover:bg-zinc-800 p-2 text-zinc-200 ring-1 transition"
        >
          <DownloadIcon className="size-4" />
        </button>
        <button
          type="button"
          onClick={onClose}
          title="Close (Esc)"
          className="ring-border/30 hover:bg-zinc-800 p-2 text-zinc-200 ring-1 transition"
        >
          <XIcon className="size-4" />
        </button>
      </div>

      {/* Stage: image flanked by prev/next */}
      <div
        className="flex min-h-0 flex-1 items-center justify-center gap-2 px-2 pb-6 sm:gap-4 sm:px-4"
        onClick={(e) => e.stopPropagation()}
      >
        {count > 1 && (
          <button
            type="button"
            onClick={() => onIndexChange((index - 1 + count) % count)}
            title="Previous (←)"
            className="bg-zinc-900/60 hover:bg-zinc-800 shrink-0 rounded-full p-2 text-zinc-200 transition"
          >
            <ChevronLeftIcon className="size-6" />
          </button>
        )}
        <AuthedImage
          // Force a fresh element per image so the loader shows between shots.
          key={shot.att.id}
          storageUrl={shot.att.storage_url}
          alt={`Screenshot from ${shot.label}`}
          className="max-h-full max-w-full object-contain"
        />
        {count > 1 && (
          <button
            type="button"
            onClick={() => onIndexChange((index + 1) % count)}
            title="Next (→)"
            className="bg-zinc-900/60 hover:bg-zinc-800 shrink-0 rounded-full p-2 text-zinc-200 transition"
          >
            <ChevronRightIcon className="size-6" />
          </button>
        )}
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
