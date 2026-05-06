'use client'

import { useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Trash2, Eye, RefreshCw, Upload, Cpu } from 'lucide-react'
import { scormApi } from '@/lib/api'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import Link from 'next/link'

interface Snapshot {
  id: string
  source_type: 'upload' | 'generated'
  original_name: string
  status: string
  coverage_pct: number
  sco_count: number
  language_codes: string[]
  cached: boolean
  created_at: string
  error_detail?: string
}

interface SnapshotTableProps {
  orgId: string
  orgSlug: string
}

const STATUS_STYLES: Record<string, React.CSSProperties> = {
  pending:    { background: 'rgba(255,255,255,0.06)', color: 'var(--text-secondary)', border: '1px solid var(--border-strong)' },
  processing: { background: 'rgba(251,191,36,0.12)', color: 'var(--skipped)', border: '1px solid rgba(251,191,36,0.25)' },
  complete:   { background: 'rgba(52,211,153,0.12)', color: 'var(--passed)', border: '1px solid rgba(52,211,153,0.25)' },
  error:      { background: 'rgba(248,113,113,0.12)', color: 'var(--failed)', border: '1px solid rgba(248,113,113,0.25)' },
  failed:     { background: 'rgba(248,113,113,0.12)', color: 'var(--failed)', border: '1px solid rgba(248,113,113,0.25)' },
  timeout:    { background: 'rgba(251,191,36,0.08)', color: 'var(--skipped)', border: '1px solid rgba(251,191,36,0.20)' },
}

const selectStyle: React.CSSProperties = {
  height: 32,
  padding: '0 10px',
  background: 'rgba(7,7,15,0.8)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  fontSize: 12,
  color: 'var(--text-primary)',
  fontFamily: 'Inter, sans-serif',
  outline: 'none',
}

export function SnapshotTable({ orgId, orgSlug }: SnapshotTableProps) {
  const qc = useQueryClient()
  const [page, setPage] = useState(0)
  const [statusFilter, setStatusFilter] = useState('')
  const limit = 15

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['snapshots', orgId, page, statusFilter],
    queryFn: () =>
      scormApi.listSnapshots(orgId, {
        limit,
        offset: page * limit,
        status: statusFilter || undefined,
      }).then((r) => r.data),
    refetchInterval: 5000,
  })

  const snapshots: Snapshot[] = data?.snapshots ?? []

  const deleteSnapshot = useMutation({
    mutationFn: (id: string) => scormApi.deleteSnapshot(orgId, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['snapshots', orgId] })
      toast.success('Snapshot archived')
    },
    onError: () => toast.error('Failed to archive snapshot'),
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Filter + refresh */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0) }} style={selectStyle}>
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="processing">Processing</option>
          <option value="complete">Complete</option>
          <option value="error">Error</option>
          <option value="failed">Failed</option>
        </select>

        <button
          onClick={() => refetch()}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: 6, borderRadius: 'var(--radius-sm)', animation: isFetching ? 'spin 0.8s linear infinite' : 'none' }}
          title="Refresh"
        >
          <RefreshCw size={13} />
        </button>

        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
          Auto-refreshes every 5s
        </span>
      </div>

      {/* Table */}
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border-strong)' }}>
              {['File', 'Source', 'Status', 'Coverage', 'SCOs', 'Languages', 'Age', ''].map((h) => (
                <th key={h} style={{ padding: '10px 14px', fontSize: 11, fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'left' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={8} style={{ padding: 32, textAlign: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 13 }}>
                    <RefreshCw size={14} style={{ animation: 'spin 0.8s linear infinite' }} />
                    Loading…
                  </div>
                </td>
              </tr>
            )}

            {!isLoading && snapshots.length === 0 && (
              <tr>
                <td colSpan={8} style={{ padding: '40px 16px', textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
                  No snapshots yet
                </td>
              </tr>
            )}

            {snapshots.map((snap) => (
              <tr key={snap.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '12px 14px' }}>
                  <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={snap.original_name}>
                    {snap.original_name}
                  </p>
                  {snap.cached && (
                    <span style={{ fontSize: 10, color: 'var(--accent-light)' }}>cached</span>
                  )}
                </td>
                <td style={{ padding: '12px 14px' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--text-muted)' }}>
                    {snap.source_type === 'upload'
                      ? <><Upload size={11} /> Upload</>
                      : <><Cpu size={11} /> Generated</>}
                  </span>
                </td>
                <td style={{ padding: '12px 14px' }}>
                  <span style={{ ...STATUS_STYLES[snap.status] ?? STATUS_STYLES.pending, borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 500 }}>
                    {snap.status}
                  </span>
                  {snap.error_detail && (
                    <p style={{ marginTop: 3, fontSize: 10, color: 'var(--failed)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={snap.error_detail}>
                      {snap.error_detail}
                    </p>
                  )}
                </td>
                <td style={{ padding: '12px 14px' }}>
                  {snap.status === 'complete' ? (
                    <span style={{ fontWeight: 600, fontSize: 13, color: snap.coverage_pct >= 80 ? 'var(--passed)' : snap.coverage_pct >= 50 ? 'var(--skipped)' : 'var(--failed)' }}>
                      {Math.round(snap.coverage_pct)}%
                    </span>
                  ) : <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>—</span>}
                </td>
                <td style={{ padding: '12px 14px', fontSize: 12, color: 'var(--text-muted)' }}>
                  {snap.sco_count || '—'}
                </td>
                <td style={{ padding: '12px 14px', fontSize: 12, color: 'var(--text-muted)' }}>
                  {(snap.language_codes ?? []).join(', ') || '—'}
                </td>
                <td style={{ padding: '12px 14px', fontSize: 11, color: 'var(--text-muted)' }}>
                  {formatDistanceToNow(new Date(snap.created_at), { addSuffix: true })}
                </td>
                <td style={{ padding: '12px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {snap.status === 'complete' && (
                      <Link
                        href={`/${orgSlug}/scorm/${snap.id}`}
                        style={{ display: 'flex', padding: 5, borderRadius: 4, color: 'var(--text-muted)', textDecoration: 'none' }}
                        title="View result"
                      >
                        <Eye size={13} />
                      </Link>
                    )}
                    <button
                      onClick={() => confirm('Archive this snapshot?') && deleteSnapshot.mutate(snap.id)}
                      style={{ display: 'flex', padding: 5, borderRadius: 4, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
                      title="Archive"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          disabled={page === 0}
          style={{ height: 30, padding: '0 12px', fontSize: 12, color: 'var(--text-muted)', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', cursor: page === 0 ? 'not-allowed' : 'pointer', opacity: page === 0 ? 0.4 : 1 }}
        >
          Previous
        </button>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Page {page + 1}</span>
        <button
          onClick={() => setPage((p) => p + 1)}
          disabled={snapshots.length < limit}
          style={{ height: 30, padding: '0 12px', fontSize: 12, color: 'var(--text-muted)', background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', cursor: snapshots.length < limit ? 'not-allowed' : 'pointer', opacity: snapshots.length < limit ? 0.4 : 1 }}
        >
          Next
        </button>
      </div>
    </div>
  )
}
