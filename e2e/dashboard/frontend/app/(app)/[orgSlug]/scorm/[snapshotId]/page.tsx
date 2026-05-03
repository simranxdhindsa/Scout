'use client'

import { useQuery } from '@tanstack/react-query'
import { scormApi } from '@/lib/api'
import { Topbar } from '@/components/layout/Topbar'
import { ResultViewer } from '@/components/scorm/ResultViewer'
import { CoverageRing } from '@/components/scorm/CoverageRing'
import { StatusPoller } from '@/components/scorm/StatusPoller'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { useCurrentOrg } from '@/lib/auth'
import { formatDistanceToNow } from 'date-fns'
import s from '../Scorm.module.css'

interface PageProps { params: { orgSlug: string; snapshotId: string } }

export default function SnapshotDetailPage({ params }: PageProps) {
  const { orgSlug, snapshotId } = params
  const org = useCurrentOrg(orgSlug)
  const orgId = org?.id ?? ''

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['snapshot', snapshotId],
    queryFn: () => scormApi.getSnapshot(orgId, snapshotId).then((r) => r.data),
    enabled: !!orgId,
  })

  const snapshot = data

  return (
    <>
      <Topbar
        title={snapshot?.original_name ?? 'Snapshot'}
        actions={
          <Link
            href={`/${orgSlug}/scorm`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', textDecoration: 'none', padding: '4px 8px', borderRadius: 'var(--radius-sm)' }}
          >
            <ArrowLeft size={13} /> SCORM
          </Link>
        }
      />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', zIndex: 1 }}>
        {isLoading && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 28, height: 28, border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
          </div>
        )}

        {snapshot && (
          <>
            {/* Meta bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 20, borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', padding: '12px 24px', flexShrink: 0 }}>
              {snapshot.status === 'complete' && (
                <CoverageRing pct={snapshot.coverage_pct ?? 0} size={56} stroke={6} label="Coverage" />
              )}
              <div>
                <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 400 }}>
                  {snapshot.original_name}
                </p>
                <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {snapshot.source_type} · {formatDistanceToNow(new Date(snapshot.created_at), { addSuffix: true })}
                </p>
              </div>
              {snapshot.cached && (
                <span style={{ fontSize: 11, background: 'var(--accent-subtle)', border: '1px solid var(--accent-border)', color: 'var(--accent-light)', borderRadius: 'var(--radius-full)', padding: '2px 8px' }}>
                  cached
                </span>
              )}
            </div>

            {/* Status poller */}
            {!['complete', 'error', 'failed', 'timeout'].includes(snapshot.status) && (
              <div style={{ padding: '16px 24px 0' }}>
                <StatusPoller
                  orgId={orgId}
                  snapshotId={snapshotId}
                  initialStatus={snapshot.status}
                  onComplete={() => refetch()}
                />
              </div>
            )}

            {/* Error detail */}
            {(snapshot.status === 'error' || snapshot.status === 'failed') && snapshot.error_detail && (
              <div style={{ margin: '16px 24px 0', padding: '12px 16px', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)', borderRadius: 'var(--radius-md)' }}>
                <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--failed)', marginBottom: 4 }}>Error Detail</p>
                <p style={{ fontSize: 12, color: 'var(--failed)', opacity: 0.8 }}>{snapshot.error_detail}</p>
              </div>
            )}

            {/* Result viewer */}
            {snapshot.status === 'complete' && snapshot.result_json && (
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <ResultViewer result={snapshot.result_json} />
              </div>
            )}

            <div className={s.footer}>Handcrafted by Simran · ApyHub QA · 2026</div>
          </>
        )}
      </div>
    </>
  )
}
