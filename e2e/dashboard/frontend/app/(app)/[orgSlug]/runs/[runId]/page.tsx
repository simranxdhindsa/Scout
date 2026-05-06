'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { runsApi, reportsApi } from '@/lib/api'
import { Topbar } from '@/components/layout/Topbar'
import { LiveOutput } from '@/components/runs/LiveOutput'
import { ReportView } from '@/components/runs/ReportView'
import { ArrowLeft, Zap } from 'lucide-react'
import Link from 'next/link'
import { useCurrentOrg } from '@/lib/auth'
import { formatDistanceToNow } from 'date-fns'
import s from './RunDetail.module.css'

interface PageProps { params: { orgSlug: string; runId: string } }

export default function RunDetailPage({ params }: PageProps) {
  const { orgSlug, runId } = params
  const org = useCurrentOrg(orgSlug)
  const orgId = org?.id ?? ''
  const [tab, setTab] = useState<'live' | 'report'>('live')
  const [currentStatus, setCurrentStatus] = useState<string>('queued')

  const { data: runData } = useQuery({
    queryKey: ['run', orgId, runId],
    queryFn: () => runsApi.get(orgId, runId).then((r) => r.data),
    enabled: !!orgId,
    refetchInterval: currentStatus === 'running' || currentStatus === 'queued' ? 5000 : false,
  })

  const { data: reportData } = useQuery({
    queryKey: ['report', runId],
    queryFn: () => reportsApi.get(runId).then((r) => r.data),
    enabled: tab === 'report' && !!runId,
  })

  const run   = runData?.run
  const items = runData?.items ?? []

  return (
    <>
      <Topbar
        title="Run Detail"
        actions={
          <Link href={`/${orgSlug}/runs`} className={s.backBtn}>
            <ArrowLeft size={13} /> All Runs
          </Link>
        }
      />

      <div className={s.page}>
        {/* Meta bar */}
        {run && (
          <div className={s.metaBar}>
            <div>
              <p className={s.metaLabel}>{run.label || 'Unnamed run'}</p>
              <p className={s.metaSub}>
                {formatDistanceToNow(new Date(run.created_at), { addSuffix: true })}
              </p>
            </div>
            <StatusBadge status={run.status} s={s} />
            <span className={s.metaRight} style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {items.length} test{items.length !== 1 ? 's' : ''}
            </span>
          </div>
        )}

        {/* Tabs */}
        <div className={s.tabBar}>
          {(['live', 'report'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`${s.tab} ${tab === t ? s.tabActive : ''}`}
            >
              {t === 'live' ? 'Live Output' : 'Report'}
            </button>
          ))}

          {run?.status === 'failed' && (
            <Link href={`/${orgSlug}/ai`} style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--violet-light)', textDecoration: 'none', padding: '0 10px' }}>
              <Zap size={12} /> Analyze with AI
            </Link>
          )}
        </div>

        {/* Content */}
        <div className={s.content}>
          {tab === 'live' && (
            <LiveOutput
              orgId={orgId}
              runId={runId}
              initialStatus={run?.status}
              onStatusChange={setCurrentStatus}
            />
          )}

          {tab === 'report' && reportData && (
            <ReportView
              report={reportData.report}
              items={reportData.items ?? []}
            />
          )}

          {tab === 'report' && !reportData && (
            <div className={s.emptyState}>
              {currentStatus === 'running' || currentStatus === 'queued'
                ? 'Report will appear when the run completes'
                : 'No report available'}
            </div>
          )}
        </div>

        <div className={s.footer}>Handcrafted by Simran · ApyHub QA · 2026</div>
      </div>
    </>
  )
}

function StatusBadge({ status, s }: { status: string; s: Record<string, string> }) {
  const map: Record<string, string> = {
    done: s.badgePassed, failed: s.badgeFailed, running: s.badgeRunning,
    queued: s.badgeQueued, stopped: s.badgeStopped,
  }
  return <span className={`${s.badge} ${map[status] ?? s.badgeQueued}`}>{status}</span>
}
