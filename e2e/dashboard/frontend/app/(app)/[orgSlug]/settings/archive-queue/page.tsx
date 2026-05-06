'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { testsApi } from '@/lib/api'
import { Topbar } from '@/components/layout/Topbar'
import { CheckCircle2, XCircle, Archive } from 'lucide-react'
import { useCurrentOrg } from '@/lib/auth'
import { formatDistanceToNow } from 'date-fns'
import toast from 'react-hot-toast'
import { useState } from 'react'
import s from '../Settings.module.css'

interface PageProps { params: { orgSlug: string } }

interface ArchiveRequest {
  id: string
  test_case_id: string
  test_case_name: string
  reason: string
  requester_name: string
  status: string
  created_at: string
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  height: 34,
  padding: '0 10px',
  background: 'rgba(7,7,15,0.8)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  fontSize: 13,
  color: 'var(--text-primary)',
  fontFamily: 'Inter, sans-serif',
  outline: 'none',
}

export default function ArchiveQueuePage({ params }: PageProps) {
  const { orgSlug } = params
  const org = useCurrentOrg(orgSlug)
  const orgId = org?.id ?? ''
  const qc = useQueryClient()
  const [rejectId, setRejectId] = useState<string | null>(null)
  const [rejectComment, setRejectComment] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['archive-queue', orgId],
    queryFn: () => testsApi.listArchiveQueue(orgId).then((r) => r.data),
    enabled: !!orgId,
  })

  const approve = useMutation({
    mutationFn: (id: string) => testsApi.approveArchive(orgId, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['archive-queue', orgId] })
      toast.success('Test case permanently deleted')
    },
    onError: () => toast.error('Failed to approve'),
  })

  const reject = useMutation({
    mutationFn: ({ id, comment }: { id: string; comment: string }) =>
      testsApi.rejectArchive(orgId, id, comment),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['archive-queue', orgId] })
      toast.success('Request rejected')
      setRejectId(null)
      setRejectComment('')
    },
    onError: () => toast.error('Failed to reject'),
  })

  const requests: ArchiveRequest[] = data?.requests ?? []

  return (
    <>
      <Topbar title="Settings" />
      <div className={s.page}>
        <h1 className={s.pageTitle}>Archive Queue</h1>

        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>
          Test cases submitted for deletion require admin approval. Approved requests are permanently deleted.
        </p>

        {isLoading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
            <div style={{ width: 18, height: 18, border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
          </div>
        )}

        {!isLoading && requests.length === 0 && (
          <div className={s.card} style={{ textAlign: 'center', padding: '48px 24px' }}>
            <Archive size={28} style={{ margin: '0 auto 12px', opacity: 0.3, color: 'var(--text-muted)', display: 'block' }} />
            <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 4 }}>No pending requests</p>
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Archive requests will appear here for review</p>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {requests.map((req) => (
            <div key={req.id} className={s.card}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>{req.test_case_name}</p>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Requested by <span style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>{req.requester_name}</span>
                    {' · '}
                    {formatDistanceToNow(new Date(req.created_at), { addSuffix: true })}
                  </p>
                  {req.reason && (
                    <p style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                      "{req.reason}"
                    </p>
                  )}
                </div>
              </div>

              {rejectId === req.id && (
                <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                  <input
                    autoFocus
                    value={rejectComment}
                    onChange={(e) => setRejectComment(e.target.value)}
                    placeholder="Reason for rejection (optional)"
                    style={inputStyle}
                  />
                  <button
                    onClick={() => reject.mutate({ id: req.id, comment: rejectComment })}
                    disabled={reject.isPending}
                    className={s.btnDestructive}
                    style={{ height: 34, padding: '0 14px', fontSize: 13, opacity: reject.isPending ? 0.6 : 1 }}
                  >
                    Confirm Reject
                  </button>
                  <button onClick={() => setRejectId(null)} className={s.btnSecondary} style={{ height: 34 }}>
                    Cancel
                  </button>
                </div>
              )}

              {rejectId !== req.id && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
                  <button
                    onClick={() => { setRejectId(req.id); setRejectComment('') }}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 30, padding: '0 12px', fontSize: 12, border: '1px solid rgba(248,113,113,0.3)', background: 'rgba(248,113,113,0.08)', color: 'var(--failed)', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}
                  >
                    <XCircle size={13} /> Reject
                  </button>
                  <button
                    onClick={() => confirm(`Permanently delete "${req.test_case_name}"? This cannot be undone.`) && approve.mutate(req.id)}
                    disabled={approve.isPending}
                    className={s.btnDestructive}
                    style={{ height: 30, padding: '0 12px', fontSize: 12, opacity: approve.isPending ? 0.6 : 1 }}
                  >
                    <CheckCircle2 size={13} /> Approve & Delete
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className={s.footer}>Handcrafted by Simran · ApyHub QA · 2026</div>
      </div>
    </>
  )
}
