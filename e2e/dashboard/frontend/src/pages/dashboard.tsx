import { useEffect, useMemo, useState } from "react"
import {
  ActivityIcon,
  ArrowRightIcon,
  CircleCheckIcon,
  CircleXIcon,
  PlayIcon,
} from "lucide-react"
import { Link } from "react-router-dom"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useActiveOrg } from "@/lib/auth"
import {
  overviewApi,
  type OverviewStats,
  type RecentRun,
  type RunStatus,
  type TrendPoint,
} from "@/lib/scout-api"

const statusClass: Record<RunStatus, string> = {
  failed: "bg-rose-500/10 text-rose-300 ring-rose-500/30",
  done: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30",
  running: "bg-sky-500/10 text-sky-300 ring-sky-500/30",
  queued: "bg-amber-500/10 text-amber-300 ring-amber-500/30",
  stopped: "bg-zinc-500/10 text-zinc-300 ring-zinc-500/30",
}

const statusDot: Record<RunStatus, string> = {
  failed: "bg-rose-400",
  done: "bg-emerald-400",
  running: "bg-sky-400",
  queued: "bg-amber-400",
  stopped: "bg-zinc-400",
}

function relativeTime(iso: string) {
  const then = new Date(iso).getTime()
  const seconds = Math.max(1, Math.round((Date.now() - then) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `about ${minutes} minute${minutes === 1 ? "" : "s"} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `about ${hours} hour${hours === 1 ? "" : "s"} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? "" : "s"} ago`
}

export default function DashboardPage() {
  const org = useActiveOrg()
  const [stats, setStats] = useState<OverviewStats | null>(null)
  const [trend, setTrend] = useState<TrendPoint[] | null>(null)
  const [runs, setRuns] = useState<RecentRun[] | null>(null)
  const [error] = useState<string | null>(null)

  useEffect(() => {
    if (!org) return
    let cancelled = false

    const loadStats = () =>
      overviewApi.stats(org.id).then((s) => {
        if (!cancelled) setStats(s)
      })
    const loadRuns = () =>
      overviewApi.recentRuns(org.id, 8).then((r) => {
        if (!cancelled) setRuns(r)
      })
    const loadTrend = () =>
      overviewApi.trend(org.id, 14).then((t) => {
        if (!cancelled) setTrend(t)
      })

    loadStats().catch(() => {})
    loadRuns().catch(() => {})
    loadTrend().catch(() => {})

    const statsInterval = window.setInterval(() => {
      loadStats().catch(() => {})
    }, 15_000)
    const runsInterval = window.setInterval(() => {
      loadRuns().catch(() => {})
    }, 10_000)

    return () => {
      cancelled = true
      window.clearInterval(statsInterval)
      window.clearInterval(runsInterval)
    }
  }, [org])

  const cards = useMemo(
    () => [
      {
        label: "Total Runs",
        value: stats?.total_runs.toLocaleString(),
        hint: "This workspace",
        icon: <ActivityIcon className="size-4" />,
        accent: "from-indigo-500/15 to-transparent ring-indigo-500/20",
        hintClass: "text-emerald-400",
      },
      {
        label: "Tests Passed",
        value: stats?.total_passed.toLocaleString(),
        hint: "across all runs",
        icon: <CircleCheckIcon className="size-4 text-emerald-400" />,
        accent: "from-emerald-500/15 to-transparent ring-emerald-500/20",
      },
      {
        label: "Tests Failed",
        value: stats?.total_failed.toLocaleString(),
        hint: "across all runs",
        icon: <CircleXIcon className="size-4 text-rose-400" />,
        accent: "from-rose-500/15 to-transparent ring-rose-500/20",
      },
      {
        label: "Avg Pass Rate",
        value: stats ? `${Math.round(stats.avg_pass_rate)}%` : undefined,
        hint: "Last 14 days",
        icon: <ActivityIcon className="size-4" />,
        accent: "from-violet-500/15 to-transparent ring-violet-500/20",
        hintClass: "text-emerald-400",
      },
    ],
    [stats],
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Overview</h1>
          {org ? (
            <p className="text-muted-foreground text-sm">
              {org.name} workspace
            </p>
          ) : (
            <Skeleton className="mt-1 h-4 w-32" />
          )}
        </div>
        <Button asChild>
          <Link to="/dashboard/runs">
            <PlayIcon className="size-4" />
            View Runs
          </Link>
        </Button>
      </div>

      {error ? (
        <p className="text-destructive text-sm">{error}</p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((s) => (
          <div
            key={s.label}
            className={`relative overflow-hidden bg-gradient-to-br ${s.accent} ring-1 p-5`}
          >
            <div className="bg-background/40 ring-border/40 mb-6 inline-flex size-9 items-center justify-center ring-1">
              {s.icon}
            </div>
            <div className="text-4xl font-semibold tracking-tight">
              {s.value ?? <Skeleton className="h-9 w-20" />}
            </div>
            <div className="text-muted-foreground mt-1 text-sm">{s.label}</div>
            <div
              className={`mt-3 text-xs ${s.hintClass ?? "text-muted-foreground"}`}
            >
              {s.hintClass ? "↗ " : ""}
              {s.hint}
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="bg-card/40 ring-border/40 flex min-h-[420px] flex-col p-5 ring-1">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">
              Pass / Fail Trend — 14 Days
            </h3>
            <Link
              to="/dashboard/runs"
              className="text-primary inline-flex items-center gap-1 text-xs"
            >
              All runs <ArrowRightIcon className="size-3" />
            </Link>
          </div>
          <div className="flex flex-1 items-center justify-center py-6">
            {trend === null ? (
              <div className="flex h-full w-full items-end gap-2">
                {Array.from({ length: 14 }).map((_, i) => (
                  <Skeleton
                    key={i}
                    className="h-56 flex-1"
                    style={{ opacity: 0.4 + (i % 7) * 0.08 }}
                  />
                ))}
              </div>
            ) : (
              <TrendChart data={trend} />
            )}
          </div>
          <div className="text-muted-foreground flex items-center gap-4 text-xs">
            <span className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-emerald-400" /> Passed
            </span>
            <span className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-rose-400" /> Failed
            </span>
          </div>
        </div>

        <div className="bg-card/40 ring-border/40 flex flex-col p-5 ring-1">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Recent Runs</h3>
            <Link
              to="/dashboard/runs"
              className="text-primary inline-flex items-center gap-1 text-xs"
            >
              View all <ArrowRightIcon className="size-3" />
            </Link>
          </div>
          {runs === null ? (
            <ul className="flex flex-col">
              {Array.from({ length: 6 }).map((_, i) => (
                <li
                  key={i}
                  className="border-border/40 flex items-center justify-between gap-3 py-3 not-last:border-b"
                >
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <Skeleton className="mt-1.5 size-2 shrink-0 rounded-full" />
                    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <Skeleton className="h-3.5 w-40" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                  </div>
                  <Skeleton className="h-5 w-14" />
                </li>
              ))}
            </ul>
          ) : runs.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">
              No runs yet
            </p>
          ) : (
            <ul className="flex flex-col">
              {runs.map((r) => (
                <li
                  key={r.id}
                  className="border-border/40 flex items-center justify-between gap-3 py-3 not-last:border-b"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      className={`mt-1.5 size-2 shrink-0 rounded-full ${statusDot[r.status]}`}
                    />
                    <div className="min-w-0">
                      <div className="truncate text-sm">{r.label}</div>
                      <div className="text-muted-foreground text-xs">
                        {relativeTime(r.created_at)}
                      </div>
                    </div>
                  </div>
                  <span
                    className={`px-2 py-1 text-[10px] font-medium tracking-wider uppercase ring-1 ${statusClass[r.status]}`}
                  >
                    {r.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

function TrendChart({ data }: { data: TrendPoint[] }) {
  if (!data.length) {
    return <p className="text-muted-foreground text-sm">No run data yet</p>
  }

  const max = Math.max(
    1,
    ...data.map((d) => d.passed + d.failed),
  )

  return (
    <div className="flex h-full w-full items-end gap-2">
      {data.map((d) => {
        const total = d.passed + d.failed
        const passedHeight = total === 0 ? 0 : (d.passed / max) * 100
        const failedHeight = total === 0 ? 0 : (d.failed / max) * 100
        return (
          <div
            key={d.date}
            className="flex flex-1 flex-col items-center gap-1"
            title={`${d.date} — ${d.passed} passed, ${d.failed} failed`}
          >
            <div className="flex h-56 w-full flex-col-reverse">
              <div
                className="w-full bg-emerald-400/80"
                style={{ height: `${passedHeight}%` }}
              />
              <div
                className="w-full bg-rose-400/80"
                style={{ height: `${failedHeight}%` }}
              />
            </div>
            <span className="text-muted-foreground text-[10px]">
              {d.date.slice(5)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
