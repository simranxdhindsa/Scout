'use client'

import { useState } from 'react'
import { Plus, GripVertical, Trash2, Save, Play } from 'lucide-react'
import { pipelinesApi, environmentsApi } from '@/lib/api'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'

interface Step {
  id: string
  target_type: 'test_case' | 'folder'
  target_id: string
  target_label: string
  environment_id?: string
  on_failure: 'halt' | 'continue'
}

interface Pipeline {
  id?: string
  name: string
  description: string
  steps: Step[]
}

interface PipelineBuilderProps {
  orgId: string
  orgSlug: string
  initial?: Pipeline & { id: string }
  onSaved?: (pipelineId: string) => void
}

let uiIdCounter = 0
const uid = () => `step-${uiIdCounter++}`

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: 34,
  padding: '0 10px',
  background: 'rgba(7,7,15,0.8)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  fontSize: 12,
  color: 'var(--text-primary)',
  fontFamily: 'Inter, sans-serif',
  outline: 'none',
}

const selectStyle: React.CSSProperties = {
  height: 28,
  padding: '0 8px',
  background: 'rgba(7,7,15,0.8)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-sm)',
  fontSize: 11,
  color: 'var(--text-primary)',
  fontFamily: 'Inter, sans-serif',
  outline: 'none',
}

export function PipelineBuilder({ orgId, orgSlug, initial, onSaved }: PipelineBuilderProps) {
  const qc = useQueryClient()
  const isEdit = !!initial?.id

  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [steps, setSteps] = useState<Step[]>(
    initial?.steps?.map((s: any) => ({ ...s, id: uid() })) ?? []
  )
  const [dragIdx, setDragIdx] = useState<number | null>(null)

  const { data: envsData } = useQuery({
    queryKey: ['environments', orgId],
    queryFn: () => environmentsApi.list(orgId).then((r) => r.data),
  })
  const envs: { id: string; name: string }[] = envsData?.environments ?? []

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name,
        description,
        steps: steps.map((s, i) => ({
          step_order: i + 1,
          target_type: s.target_type,
          target_id: s.target_id,
          environment_id: s.environment_id || undefined,
          on_failure: s.on_failure,
        })),
      }
      return isEdit
        ? pipelinesApi.update(orgId, initial!.id, payload)
        : pipelinesApi.create(orgId, payload)
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['pipelines', orgId] })
      toast.success(isEdit ? 'Pipeline updated' : 'Pipeline created')
      onSaved?.(res.data.id)
    },
    onError: () => toast.error('Failed to save pipeline'),
  })

  const runNow = useMutation({
    mutationFn: () => pipelinesApi.run(orgId, initial!.id, {}),
    onSuccess: () => toast.success('Pipeline run started'),
    onError: () => toast.error('Failed to start run'),
  })

  const addStep = () => {
    const targetId = prompt('Target ID (test case or folder UUID):')
    const targetLabel = prompt('Label (e.g. "Login Tests"):') ?? 'Unnamed step'
    if (!targetId?.trim()) return
    setSteps((prev) => [
      ...prev,
      { id: uid(), target_type: 'folder', target_id: targetId.trim(), target_label: targetLabel, on_failure: 'halt' },
    ])
  }

  const removeStep = (id: string) => setSteps((prev) => prev.filter((s) => s.id !== id))
  const updateStep = (id: string, patch: Partial<Step>) =>
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))

  const onDragStart = (idx: number) => setDragIdx(idx)
  const onDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault()
    if (dragIdx === null || dragIdx === idx) return
    setSteps((prev) => {
      const next = [...prev]
      const [moved] = next.splice(dragIdx, 1)
      next.splice(idx, 0, moved)
      return next
    })
    setDragIdx(idx)
  }
  const onDragEnd = () => setDragIdx(null)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Meta */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 6 }}>Pipeline Name *</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full regression suite" style={inputStyle} />
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 6 }}>Description</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional description" style={inputStyle} />
        </div>
      </div>

      {/* Steps */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>Steps ({steps.length})</p>
          <button
            onClick={addStep}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 28, padding: '0 10px', fontSize: 12, color: 'var(--accent-light)', background: 'var(--accent-subtle)', border: '1px dashed var(--accent-border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}
          >
            <Plus size={12} /> Add Step
          </button>
        </div>

        {steps.length === 0 && (
          <div style={{ padding: '32px 16px', textAlign: 'center', border: '1px dashed var(--border-strong)', borderRadius: 'var(--radius-md)' }}>
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No steps yet — add a test case or folder</p>
          </div>
        )}

        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {steps.map((step, idx) => (
            <li
              key={step.id}
              draggable
              onDragStart={() => onDragStart(idx)}
              onDragOver={(e) => onDragOver(e, idx)}
              onDragEnd={onDragEnd}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                background: 'var(--bg-elevated)',
                border: `1px solid ${dragIdx === idx ? 'var(--accent-border)' : 'var(--border)'}`,
                borderRadius: 'var(--radius-md)',
                padding: '10px 12px',
                opacity: dragIdx === idx ? 0.5 : 1,
                transition: 'opacity 150ms',
              }}
            >
              <GripVertical size={14} style={{ flexShrink: 0, cursor: 'grab', color: 'var(--text-muted)' }} />

              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20, flexShrink: 0, borderRadius: '50%', background: 'var(--accent-subtle)', border: '1px solid var(--accent-border)', fontSize: 10, fontWeight: 700, color: 'var(--accent-light)' }}>
                {idx + 1}
              </span>

              <div style={{ display: 'flex', flex: 1, flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                <input
                  value={step.target_label}
                  onChange={(e) => updateStep(step.id, { target_label: e.target.value })}
                  style={{ ...inputStyle, flex: 1, minWidth: 80, height: 28, fontSize: 12 }}
                  placeholder="Step label"
                />

                <select
                  value={step.target_type}
                  onChange={(e) => updateStep(step.id, { target_type: e.target.value as any })}
                  style={selectStyle}
                >
                  <option value="folder">Folder</option>
                  <option value="test_case">Test Case</option>
                </select>

                <select
                  value={step.environment_id ?? ''}
                  onChange={(e) => updateStep(step.id, { environment_id: e.target.value || undefined })}
                  style={selectStyle}
                >
                  <option value="">Default env</option>
                  {envs.map((e) => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </select>

                <select
                  value={step.on_failure}
                  onChange={(e) => updateStep(step.id, { on_failure: e.target.value as any })}
                  style={selectStyle}
                >
                  <option value="halt">Halt on failure</option>
                  <option value="continue">Continue on failure</option>
                </select>
              </div>

              <button
                onClick={() => removeStep(step.id)}
                style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: 4, borderRadius: 4 }}
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
        {isEdit && (
          <button
            onClick={() => runNow.mutate()}
            disabled={runNow.isPending}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 32, padding: '0 14px', fontSize: 12, fontWeight: 500, background: 'rgba(52,211,153,0.10)', border: '1px solid rgba(52,211,153,0.25)', color: 'var(--passed)', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}
          >
            <Play size={12} /> Run Now
          </button>
        )}
        <button
          onClick={() => save.mutate()}
          disabled={!name.trim() || save.isPending}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            height: 32, padding: '0 16px', fontSize: 13, fontWeight: 500,
            color: 'white',
            background: (name.trim() && !save.isPending) ? 'linear-gradient(135deg, #6366f1, #7c3aed)' : 'rgba(99,102,241,0.3)',
            border: '1px solid rgba(99,102,241,0.40)',
            borderRadius: 'var(--radius-md)',
            cursor: (!name.trim() || save.isPending) ? 'not-allowed' : 'pointer',
            opacity: (!name.trim() || save.isPending) ? 0.6 : 1,
          }}
        >
          <Save size={12} />
          {save.isPending ? 'Saving…' : isEdit ? 'Update Pipeline' : 'Create Pipeline'}
        </button>
      </div>
    </div>
  )
}
