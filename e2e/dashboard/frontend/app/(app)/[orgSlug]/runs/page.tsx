'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { runsApi } from '@/lib/api'
import { Topbar } from '@/components/layout/Topbar'
import { formatDistanceToNow } from 'date-fns'
import Link from 'next/link'
import { RefreshCw, Square } from 'lucide-react'
import { useCurrentOrg } from '@/lib/auth'
import toast from 'react-hot-toast'
import s from './Runs.module.css'

interface PageProps { params: { orgSlug: string } }

const STATUSES = ['', 'running', 'done', 'failed', 'queued', 'stopped']

export default function RunsPage({ params }: PageProps) {
  const { orgSlug } = params
  const org = useCurrentOrg(orgSlug)
  const orgId = org?.id ?? ''
  const qc = useQueryClient()

  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(0)
  const limit = 20

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['runs', orgId, statusFilter, page],
    queryFn: () => runsApi.list(orgId, {
      status: statusFilter || undefined,
      limit,
      offset: page * limit,
    }).then((r) => r.data),
    enabled: !!orgId,
    refetchInterval: 8_000,
  })

  const stopRun = useMutation({
    mutationFn: (runId: string) => runsApi.stop(orgId, runId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['runs', orgId] }); toast.success('Run stopped') },
    onError: () => toast.error('Failed to stop run'),
  })

  const runs = data?.runs ?? []
  const activeCount = data?.active ?? 0
  const total = data?.total ?? 0

  return (
    <>
      <Topbar title="Runs" actions={
        <button
          onClick={() => refetch()}
          className={`${s.iconBtn} ${isFetching ? s.iconBtnSpin : ''}`}
          aria-label="Refresh"
        >
          <RefreshCw size={14} />
        </button>
      } />

      <div className={s.page}>
        <div className={s.pageHeader}>
          <h1 className={s.pageTitle}>Runs</h1>
        </div>

        {/* Status filters */}
        <div className={s.filters}>
          {STATUSES.map((st) => (
            <button
              key={st}
              className={`${s.filterBtn} ${statusFilter === st ? s.filterBtnActive : ''}`}
              onClick={() => { setStatusFilter(st); setPage(0) }}
            >
              {st === '' ? 'All' : st.charAt(0).toUpperCase() + st.slice(1)}
            </button>
          ))}
        </div>

        {/* Active banner */}
        {activeCount > 0 && (
          <div className={s.activeBanner}>
            <span style={{ width: 7, height: 7, background: 'var(--running)', borderRadius: '50%', display: 'inline-block', animation: 'pulse-dot 2s ease-in-out infinite' }} />
            {activeCount} run{activeCount > 1 ? 's' : ''} in progress
          </div>
        )}

        {/* Table */}
        <div className={s.tableWrap}>
          <table className={s.table}>
            <thead>
              <tr>
                <th>Status</th>
                <th>Run</th>
                <th>Environment</th>
                <th>Started</th>
                <th>Duration</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>Loading…</td></tr>
              )}
              {!isLoading && runs.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>No runs found</td></tr>
              )}
              {runs.map((run: any) => (
                <tr key={run.id} onClick={() => window.location.href = `/${orgSlug}/runs/${run.id}`}>
                  <td>
                    <span className={`${s.badge} ${badgeClass(run.status, s)}`}>
                      {run.status === 'running' && <span className={s.pulseDot} />}
                      {run.status}
                    </span>
                  </td>
                  <td>
                    <p className={s.runName}>{run.label || 'Unnamed run'}</p>
                    <p className={s.runMeta} style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10 }}>
                      {run.id?.slice(0, 8)}
                    </p>
                  </td>
                  <td>
                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                      {run.environment?.name ?? '—'}
                    </span>
                  </td>
                  <td className={s.runMeta}>
                    {run.started_at
                      ? formatDistanceToNow(new Date(run.started_at), { addSuffix: true })
                      : formatDistanceToNow(new Date(run.created_at), { addSuffix: true })}
                  </td>
                  <td className={s.runMeta}>
                    {run.started_at && run.completed_at
                      ? formatDuration(new Date(run.started_at), new Date(run.completed_at))
                      : run.status === 'running' ? 'Running…' : '—'}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {(run.status === 'running' || run.status === 'queued') && (
                      <button className={s.stopBtn} onClick={() => stopRun.mutate(run.id)}>
                        <Square size={11} /> Stop
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {total > limit && (
            <div className={s.pagination}>
              <span className={s.pageInfo}>{page * limit + 1}–{Math.min((page + 1) * limit, total)} of {total}</span>
              <div className={s.pageBtns}>
                <button className={s.btnSecondary} onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>Previous</button>
                <button className={s.btnSecondary} onClick={() => setPage((p) => p + 1)} disabled={(page + 1) * limit >= total}>Next</button>
              </div>
            </div>
          )}
        </div>

        <div className={s.footer}>Handcrafted by Simran · ApyHub QA · 2026</div>
      </div>
    </>
  )
}

function badgeClass(status: string, s: Record<string, string>) {
  const map: Record<string, string> = {
    done: s.badgeDone, failed: s.badgeFailed, running: s.badgeRunning,
    queued: s.badgeQueued, stopped: s.badgeStopped,
  }
  return map[status] ?? s.badgeQueued
}

function formatDuration(start: Date, end: Date) {
  const ms = end.getTime() - start.getTime()
  const sec = Math.floor(ms / 1000)
  const min = Math.floor(sec / 60)
  if (min < 1) return `${sec}s`
  return `${min}m ${sec % 60}s`
}
