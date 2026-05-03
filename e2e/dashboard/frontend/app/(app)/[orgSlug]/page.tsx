'use client'

import { useQuery } from '@tanstack/react-query'
import { reportsApi, runsApi } from '@/lib/api'
import { Topbar } from '@/components/layout/Topbar'
import { TrendChart } from '@/components/runs/TrendChart'
import { formatDistanceToNow } from 'date-fns'
import Link from 'next/link'
import { PlayCircle, CheckCircle2, XCircle, Activity, TrendingUp } from 'lucide-react'
import { useCurrentOrg } from '@/lib/auth'
import s from './Dashboard.module.css'

interface PageProps { params: { orgSlug: string } }

export default function DashboardPage({ params }: PageProps) {
  const { orgSlug } = params
  const org = useCurrentOrg(orgSlug)
  const orgId = org?.id ?? ''

  const { data: statsData } = useQuery({
    queryKey: ['stats', orgId],
    queryFn: () => reportsApi.stats(orgId).then((r) => r.data),
    enabled: !!orgId,
    refetchInterval: 15_000,
  })

  const { data: trendData } = useQuery({
    queryKey: ['trend', orgId],
    queryFn: () => reportsApi.trend(orgId, 14).then((r) => r.data),
    enabled: !!orgId,
  })

  const { data: runsData } = useQuery({
    queryKey: ['runs', orgId],
    queryFn: () => runsApi.list(orgId, { limit: 8 }).then((r) => r.data),
    enabled: !!orgId,
    refetchInterval: 10_000,
  })

  const stats = statsData ?? {}
  const runs  = runsData?.runs ?? []
  const trend = trendData?.trend ?? []

  return (
    <>
      <Topbar title={org?.name ?? orgSlug} />
      <div className={s.page}>

        {/* Header */}
        <div className={s.pageHeader}>
          <div>
            <h1 className={s.pageTitle}>Overview</h1>
            <p className={s.pageSub}>{org?.name ?? orgSlug} workspace</p>
          </div>
          <Link href={`/${orgSlug}/runs`} className={s.btnPrimary}>
            <PlayCircle size={13} />
            View Runs
          </Link>
        </div>

        {/* Stats */}
        <div className={s.statsRow}>
          <div className={`${s.statCard} ${s.statAccent}`}>
            <div className={s.statIcon}><Activity size={18} /></div>
            <div className={s.statVal}>{stats.total_runs ?? 0}</div>
            <div className={s.statLabel}>Total Runs</div>
            <div className={s.statTrend}><TrendingUp size={11} /> This workspace</div>
          </div>
          <div className={`${s.statCard} ${s.statPassed}`}>
            <div className={s.statIcon} style={{ color: 'var(--passed)' }}><CheckCircle2 size={18} /></div>
            <div className={s.statVal}>{stats.total_passed ?? 0}</div>
            <div className={s.statLabel}>Tests Passed</div>
            <div className={s.statSub}>across all runs</div>
          </div>
          <div className={`${s.statCard} ${s.statFailed}`}>
            <div className={s.statIcon} style={{ color: 'var(--failed)' }}><XCircle size={18} /></div>
            <div className={s.statVal}>{stats.total_failed ?? 0}</div>
            <div className={s.statLabel}>Tests Failed</div>
            <div className={s.statSub}>across all runs</div>
          </div>
          <div className={`${s.statCard} ${s.statAccent}`}>
            <div className={s.statIcon}><Activity size={18} /></div>
            <div className={s.statVal}>{Math.round(stats.avg_pass_rate ?? 0)}%</div>
            <div className={s.statLabel}>Avg Pass Rate</div>
            <div className={s.statTrend}><TrendingUp size={11} /> Last 14 days</div>
          </div>
        </div>

        {/* Active runs banner */}
        {(stats.active_runs > 0 || stats.queued_runs > 0) && (
          <div className={s.activeBanner}>
            <span className="pulse" style={{ width: 7, height: 7, background: 'var(--running)', borderRadius: '50%', display: 'inline-block' }} />
            <span>
              {stats.active_runs > 0 && `${stats.active_runs} run${stats.active_runs > 1 ? 's' : ''} in progress`}
              {stats.active_runs > 0 && stats.queued_runs > 0 && ' · '}
              {stats.queued_runs > 0 && `${stats.queued_runs} queued`}
            </span>
            <Link href={`/${orgSlug}/runs`} className={s.activeBannerLink}>View runs →</Link>
          </div>
        )}

        {/* Main grid */}
        <div className={s.mainGrid}>
          {/* Left */}
          <div>
            {/* Trend chart */}
            <div className={s.card}>
              <div className={s.sectionHeader}>
                <span className={s.sectionTitle}>Pass / Fail Trend — 14 Days</span>
                <Link href={`/${orgSlug}/runs`} className={s.sectionLink}>All runs →</Link>
              </div>
              <div className={s.chartWrap}>
                <TrendChart data={trend} height={180} />
              </div>
              <div className={s.chartLegend}>
                <span className={s.legendItem}>
                  <span className={s.legendDot} style={{ background: 'var(--passed)' }} /> Passed
                </span>
                <span className={s.legendItem}>
                  <span className={s.legendDot} style={{ background: 'var(--failed)' }} /> Failed
                </span>
              </div>
            </div>
          </div>

          {/* Right — Recent runs */}
          <div>
            <div className={s.runsTable}>
              <div className={s.runsTableHeader}>
                <span className={s.sectionTitle}>Recent Runs</span>
                <Link href={`/${orgSlug}/runs`} className={s.sectionLink}>View all →</Link>
              </div>

              {runs.length === 0 && (
                <div className={s.emptyState}>No runs yet</div>
              )}

              {runs.map((run: any) => (
                <Link
                  key={run.id}
                  href={`/${orgSlug}/runs/${run.id}`}
                  className={s.runsTableRow}
                >
                  <span className={`${s.statusDot} ${statusDotClass(run.status, s)}`} />
                  <div className={s.runLabel}>
                    <p className={s.runName}>{run.label || 'Unnamed run'}</p>
                    <p className={s.runTime}>
                      {formatDistanceToNow(new Date(run.created_at), { addSuffix: true })}
                    </p>
                  </div>
                  <span className={`${s.badge} ${badgeClass(run.status, s)}`}>
                    {run.status}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </div>

        <div className={s.footer}>Handcrafted by Simran · ApyHub QA · 2026</div>
      </div>
    </>
  )
}

function statusDotClass(status: string, s: Record<string, string>) {
  const map: Record<string, string> = {
    done: s.dotDone, failed: s.dotFailed, running: s.dotRunning,
    queued: s.dotQueued, stopped: s.dotStopped,
  }
  return map[status] ?? s.dotQueued
}

function badgeClass(status: string, s: Record<string, string>) {
  const map: Record<string, string> = {
    done: s.badgePassed, failed: s.badgeFailed, running: s.badgeRunning,
    queued: s.badgeQueued, stopped: s.badgeStopped,
  }
  return map[status] ?? s.badgeQueued
}
