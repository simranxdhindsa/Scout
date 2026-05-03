'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { pipelinesApi } from '@/lib/api'
import { Topbar } from '@/components/layout/Topbar'
import { PipelineBuilder } from '@/components/pipelines/PipelineBuilder'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { useCurrentOrg } from '@/lib/auth'
import s from '../Pipelines.module.css'

interface PageProps { params: { orgSlug: string; pipelineId: string } }

export default function PipelineDetailPage({ params }: PageProps) {
  const { orgSlug, pipelineId } = params
  const org = useCurrentOrg(orgSlug)
  const orgId = org?.id ?? ''
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['pipeline', pipelineId],
    queryFn: () => pipelinesApi.list(orgId).then((r) =>
      r.data.pipelines?.find((p: any) => p.id === pipelineId)
    ),
    enabled: !!orgId,
  })

  return (
    <>
      <Topbar
        title={data?.name ?? 'Pipeline'}
        actions={
          <Link
            href={`/${orgSlug}/pipelines`}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', textDecoration: 'none', padding: '4px 8px', borderRadius: 'var(--radius-sm)' }}
          >
            <ArrowLeft size={13} /> Pipelines
          </Link>
        }
      />
      <div className={s.listPane} style={{ alignItems: 'flex-start' }}>
        <div style={{ width: '100%', maxWidth: 600, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 24, boxShadow: 'var(--shadow-card)' }}>
          {isLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
              <div style={{ width: 22, height: 22, border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
            </div>
          ) : data ? (
            <PipelineBuilder
              orgId={orgId}
              orgSlug={orgSlug}
              initial={data}
              onSaved={() => {
                qc.invalidateQueries({ queryKey: ['pipelines', orgId] })
              }}
            />
          ) : (
            <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>Pipeline not found</p>
          )}
        </div>

        <div className={s.footer}>Handcrafted by Simran · ApyHub QA · 2026</div>
      </div>
    </>
  )
}
