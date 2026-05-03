'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { pipelinesApi } from '@/lib/api'
import { Topbar } from '@/components/layout/Topbar'
import { PipelineBuilder } from '@/components/pipelines/PipelineBuilder'
import { Plus, GitBranch, Play, Trash2, Pencil, X } from 'lucide-react'
import { useCurrentOrg } from '@/lib/auth'
import { formatDistanceToNow } from 'date-fns'
import toast from 'react-hot-toast'
import s from './Pipelines.module.css'

interface PageProps { params: { orgSlug: string } }

export default function PipelinesPage({ params }: PageProps) {
  const { orgSlug } = params
  const org = useCurrentOrg(orgSlug)
  const orgId = org?.id ?? ''
  const qc = useQueryClient()

  const [showBuilder, setShowBuilder] = useState(false)
  const [editPipeline, setEditPipeline] = useState<any | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['pipelines', orgId],
    queryFn: () => pipelinesApi.list(orgId).then((r) => r.data),
    enabled: !!orgId,
  })

  const deletePipeline = useMutation({
    mutationFn: (id: string) => pipelinesApi.delete(orgId, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pipelines', orgId] })
      toast.success('Pipeline deleted')
    },
    onError: () => toast.error('Failed to delete pipeline'),
  })

  const runPipeline = useMutation({
    mutationFn: (id: string) => pipelinesApi.run(orgId, id, {}),
    onSuccess: (res) => {
      toast.success('Pipeline run started')
      window.location.href = `/${orgSlug}/runs/${res.data.run_id}`
    },
    onError: () => toast.error('Failed to start run'),
  })

  const pipelines = data?.pipelines ?? []

  return (
    <>
      <Topbar
        title="Pipelines"
        actions={
          <button
            onClick={() => { setShowBuilder(true); setEditPipeline(null) }}
            className={s.btnPrimary}
          >
            <Plus size={13} /> New Pipeline
          </button>
        }
      />

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Pipeline list */}
        <div className={s.listPane}>
          {isLoading && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
              <div style={{ width: 20, height: 20, border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
            </div>
          )}

          {!isLoading && pipelines.length === 0 && !showBuilder && (
            <div className={s.emptyState}>
              <GitBranch size={32} style={{ margin: '0 auto 12px', opacity: 0.3, color: 'var(--text-muted)', display: 'block' }} />
              <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 4 }}>No pipelines yet</p>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>Create a pipeline to chain test runs across products</p>
              <button onClick={() => setShowBuilder(true)} className={s.btnPrimary}>
                <Plus size={12} /> Create Pipeline
              </button>
            </div>
          )}

          {pipelines.map((pipeline: any) => (
            <div key={pipeline.id} className={s.pipelineCard}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div className={s.pipelineIcon}>
                    <GitBranch size={16} />
                  </div>
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{pipeline.name}</p>
                    {pipeline.description && (
                      <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{pipeline.description}</p>
                    )}
                    <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                      Created {formatDistanceToNow(new Date(pipeline.created_at), { addSuffix: true })}
                    </p>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button onClick={() => runPipeline.mutate(pipeline.id)} className={s.btnRun}>
                    <Play size={12} /> Run
                  </button>
                  <button onClick={() => { setEditPipeline(pipeline); setShowBuilder(true) }} className={s.btnIcon}>
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={() => confirm(`Delete pipeline "${pipeline.name}"?`) && deletePipeline.mutate(pipeline.id)}
                    className={s.btnIconDestructive}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              {pipeline.steps?.length > 0 && (
                <div className={s.stepList}>
                  {pipeline.steps.map((step: any, i: number) => (
                    <div key={step.id ?? i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className={s.stepChip}>{i + 1}. {step.target_label || step.target_type}</span>
                      {i < pipeline.steps.length - 1 && (
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>→</span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className={s.pipelineFooter}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {pipeline.steps?.length ?? 0} step{pipeline.steps?.length !== 1 ? 's' : ''}
                </span>
              </div>
            </div>
          ))}

          <div className={s.footer}>Handcrafted by Simran · ApyHub QA · 2026</div>
        </div>

        {/* Builder panel */}
        {showBuilder && (
          <div className={s.builderPane}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                {editPipeline ? 'Edit Pipeline' : 'New Pipeline'}
              </h2>
              <button
                onClick={() => { setShowBuilder(false); setEditPipeline(null) }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, display: 'flex' }}
              >
                <X size={15} />
              </button>
            </div>
            <PipelineBuilder
              orgId={orgId}
              orgSlug={orgSlug}
              initial={editPipeline}
              onSaved={() => {
                setShowBuilder(false)
                setEditPipeline(null)
                qc.invalidateQueries({ queryKey: ['pipelines', orgId] })
              }}
            />
          </div>
        )}
      </div>
    </>
  )
}
