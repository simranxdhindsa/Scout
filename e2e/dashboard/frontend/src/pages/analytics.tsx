import { useEffect, useState } from "react"
import {
  ActivityIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  ClockIcon,
  RefreshCwIcon,
  TimerIcon,
  TrendingDownIcon,
  ZapOffIcon,
} from "lucide-react"

import { useActiveOrg } from "@/lib/auth"
import {
  analyticsApi,
  type AnalyticsOverview,
  type FlakyTest,
  type SlowTest,
  type TestRunHistoryEntry,
} from "@/lib/scout-api"
import { ScoutEmptyState } from "@/components/ScoutEmptyState"
import { RunBarsLoader } from "@/components/loaders/RunBarsLoader"

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtMs(ms: number): string {
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(1)}s`
  return `${ms}ms`
}

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function PassRateBadge({ rate }: { rate: number }) {
  const color =
    rate >= 80
      ? "bg-green-500/15 text-green-400"
      : rate >= 50
        ? "bg-amber-500/15 text-amber-400"
        : "bg-red-500/15 text-red-400"
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${color}`}>
      {rate.toFixed(1)}%
    </span>
  )
}

function StatusDot({ status }: { status: TestRunHistoryEntry["status"] }) {
  const color =
    status === "passed"
      ? "bg-green-400"
      : status === "failed"
        ? "bg-red-400"
        : status === "timedOut"
          ? "bg-orange-400"
          : "bg-muted-foreground"
  return (
    <span
      className={`inline-block size-2.5 rounded-sm ${color}`}
      title={status}
    />
  )
}

// ── Metric card ───────────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  sub,
  icon: Icon,
  accent,
}: {
  label: string
  value: string | number
  sub?: string
  icon: React.ElementType
  accent?: "green" | "amber" | "red" | "blue"
}) {
  const iconColor =
    accent === "green"
      ? "text-green-400"
      : accent === "amber"
        ? "text-amber-400"
        : accent === "red"
          ? "text-red-400"
          : "text-primary"
  return (
    <div className="ring-border/40 bg-card/30 flex flex-col gap-2 p-4 ring-1">
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
          {label}
        </span>
        <Icon className={`size-4 ${iconColor}`} />
      </div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-muted-foreground text-xs">{sub}</div>}
    </div>
  )
}

// ── Test history sparkline ────────────────────────────────────────────────────

function HistorySparkline({ history }: { history: TestRunHistoryEntry[] }) {
  if (history.length === 0) return <span className="text-muted-foreground text-xs">no data</span>
  return (
    <div className="flex items-center gap-0.5">
      {[...history].reverse().map((h, i) => (
        <StatusDot key={i} status={h.status} />
      ))}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const org = useActiveOrg()
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null)
  const [flaky, setFlaky] = useState<FlakyTest[] | null>(null)
  const [slow, setSlow] = useState<SlowTest[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTestId, setActiveTestId] = useState<string | null>(null)
  const [history, setHistory] = useState<TestRunHistoryEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const load = () => {
    if (!org) return
    setLoading(true)
    Promise.all([
      analyticsApi.getOverview(org.id),
      analyticsApi.getFlakyTests(org.id),
      analyticsApi.getSlowTests(org.id),
    ])
      .then(([ov, fk, sl]) => {
        setOverview(ov)
        setFlaky(fk)
        setSlow(sl)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [org])

  const selectTest = async (testCaseId: string) => {
    if (!org) return
    if (activeTestId === testCaseId) {
      setActiveTestId(null)
      setHistory([])
      return
    }
    setActiveTestId(testCaseId)
    setHistoryLoading(true)
    try {
      const h = await analyticsApi.getTestHistory(org.id, testCaseId)
      setHistory(h)
    } catch {
      setHistory([])
    } finally {
      setHistoryLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">Analytics</h1>
        <button
          type="button"
          onClick={load}
          disabled={loading || !org}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm disabled:opacity-50"
        >
          <RefreshCwIcon className={`size-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Overview cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <MetricCard
          label="Total Tests"
          value={overview?.total_test_cases ?? "—"}
          icon={ActivityIcon}
          accent="blue"
        />
        <MetricCard
          label="Runs (7d)"
          value={overview?.runs_last_7d ?? "—"}
          sub={`${overview?.total_runs_last_7d ?? 0} run(s) completed`}
          icon={RefreshCwIcon}
        />
        <MetricCard
          label="Avg Pass Rate"
          value={overview ? `${overview.avg_pass_rate_7d.toFixed(1)}%` : "—"}
          sub="last 7 days"
          icon={CheckCircleIcon}
          accent={
            overview
              ? overview.avg_pass_rate_7d >= 80
                ? "green"
                : overview.avg_pass_rate_7d >= 50
                  ? "amber"
                  : "red"
              : undefined
          }
        />
        <MetricCard
          label="Avg Duration"
          value={overview ? fmtMs(overview.avg_duration_ms) : "—"}
          sub="per test, last 7d"
          icon={TimerIcon}
        />
        <MetricCard
          label="Flaky Tests"
          value={overview?.flaky_count ?? "—"}
          sub="last 30 days"
          icon={ZapOffIcon}
          accent={
            overview
              ? overview.flaky_count === 0
                ? "green"
                : overview.flaky_count <= 3
                  ? "amber"
                  : "red"
              : undefined
          }
        />
        <MetricCard
          label="Slow Tests"
          value={slow?.length ?? "—"}
          sub="tracked (30d)"
          icon={ClockIcon}
        />
      </div>

      {/* Two-column tables */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {/* Flaky tests */}
        <section className="ring-border/40 flex flex-col ring-1">
          <div className="border-border/40 flex items-center gap-2 border-b px-4 py-3">
            <ZapOffIcon className="text-amber-400 size-4" />
            <h2 className="font-medium">Flaky Tests</h2>
            <span className="text-muted-foreground ml-auto text-xs">last 30 days · min 3 runs</span>
          </div>
          {loading ? (
            <div className="flex justify-center py-8"><RunBarsLoader label="Loading analytics…" /></div>
          ) : flaky && flaky.length > 0 ? (
            <div className="divide-border/40 divide-y overflow-auto">
              {flaky.map((f) => (
                <div key={f.test_case_id}>
                  <button
                    type="button"
                    onClick={() => selectTest(f.test_case_id)}
                    className={`hover:bg-muted/30 flex w-full items-start gap-3 px-4 py-3 text-left transition-colors ${
                      activeTestId === f.test_case_id ? "bg-muted/40" : ""
                    }`}
                  >
                    <AlertTriangleIcon className="text-amber-400 mt-0.5 size-4 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{f.test_name}</span>
                        <PassRateBadge rate={f.pass_rate} />
                      </div>
                      <div className="text-muted-foreground mt-0.5 flex items-center gap-2 text-xs">
                        <span className="truncate">{f.sub_project_name} / {f.folder_name}</span>
                        <span className="shrink-0">
                          {f.passed_count}✓ {f.failed_count}✗ of {f.total_runs} runs
                        </span>
                      </div>
                    </div>
                    <span className="text-muted-foreground shrink-0 text-xs">
                      {fmtDate(f.last_run_at)}
                    </span>
                  </button>
                  {activeTestId === f.test_case_id && (
                    <div className="bg-muted/20 border-border/40 border-t px-4 py-3">
                      <div className="mb-1.5 flex items-center justify-between">
                        <span className="text-muted-foreground text-xs">Run history (newest → oldest)</span>
                        {historyLoading && (
                          <RefreshCwIcon className="text-muted-foreground size-3 animate-spin" />
                        )}
                      </div>
                      <HistorySparkline history={history} />
                      {history.length > 0 && (
                        <div className="text-muted-foreground mt-1.5 flex gap-3 text-xs">
                          <span className="flex items-center gap-1">
                            <span className="inline-block size-2 rounded-sm bg-green-400" /> pass
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="inline-block size-2 rounded-sm bg-red-400" /> fail
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="inline-block size-2 rounded-sm bg-orange-400" /> timeout
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <ScoutEmptyState
              message="No flaky tests"
              sub="All tests have consistent results over the last 30 days."
            />
          )}
        </section>

        {/* Slow tests */}
        <section className="ring-border/40 flex flex-col ring-1">
          <div className="border-border/40 flex items-center gap-2 border-b px-4 py-3">
            <TrendingDownIcon className="text-red-400 size-4" />
            <h2 className="font-medium">Slow Tests</h2>
            <span className="text-muted-foreground ml-auto text-xs">by avg duration · last 30 days</span>
          </div>
          {loading ? (
            <div className="text-muted-foreground p-6 text-center text-sm">Loading…</div>
          ) : slow && slow.length > 0 ? (
            <div className="divide-border/40 divide-y overflow-auto">
              {slow.map((s, idx) => (
                <button
                  key={s.test_case_id}
                  type="button"
                  onClick={() => selectTest(s.test_case_id)}
                  className={`hover:bg-muted/30 flex w-full items-start gap-3 px-4 py-3 text-left transition-colors ${
                    activeTestId === s.test_case_id ? "bg-muted/40" : ""
                  }`}
                >
                  <span className="text-muted-foreground w-5 shrink-0 pt-0.5 text-right text-xs">
                    #{idx + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{s.test_name}</div>
                    <div className="text-muted-foreground mt-0.5 truncate text-xs">
                      {s.sub_project_name} / {s.folder_name}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-medium tabular-nums">
                      {fmtMs(s.avg_duration_ms)}
                    </div>
                    <div className="text-muted-foreground text-xs tabular-nums">
                      p95 {fmtMs(s.p95_duration_ms)}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <ScoutEmptyState
              message="No timing data yet"
              sub="Run some tests to see slow test analysis."
            />
          )}
        </section>
      </div>
    </div>
  )
}
