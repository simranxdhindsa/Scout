'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { environmentsApi } from '@/lib/api'
import { Topbar } from '@/components/layout/Topbar'
import { Plus, Trash2, Pencil, Check, X } from 'lucide-react'
import { useCurrentOrg } from '@/lib/auth'
import toast from 'react-hot-toast'
import s from '../Settings.module.css'

interface PageProps { params: { orgSlug: string } }
interface Env { id: string; name: string; label: string }

const inputStyle: React.CSSProperties = {
  height: 32,
  padding: '0 10px',
  background: 'rgba(7,7,15,0.8)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  fontSize: 13,
  color: 'var(--text-primary)',
  fontFamily: 'Inter, sans-serif',
  outline: 'none',
  flex: 1,
}

export default function EnvironmentsPage({ params }: PageProps) {
  const { orgSlug } = params
  const org = useCurrentOrg(orgSlug)
  const orgId = org?.id ?? ''
  const qc = useQueryClient()

  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editLabel, setEditLabel] = useState('')

  const { data } = useQuery({
    queryKey: ['environments', orgId],
    queryFn: () => environmentsApi.list(orgId).then((r) => r.data),
    enabled: !!orgId,
  })

  const envs: Env[] = data?.environments ?? []

  const createEnv = useMutation({
    mutationFn: () => environmentsApi.create(orgId, { name: newName, label: newLabel }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['environments', orgId] })
      toast.success('Environment created')
      setCreating(false); setNewName(''); setNewLabel('')
    },
    onError: () => toast.error('Failed to create environment'),
  })

  const updateEnv = useMutation({
    mutationFn: (id: string) => environmentsApi.update(orgId, id, { name: editName, label: editLabel }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['environments', orgId] })
      toast.success('Updated'); setEditId(null)
    },
    onError: () => toast.error('Failed to update'),
  })

  const deleteEnv = useMutation({
    mutationFn: (id: string) => environmentsApi.delete(orgId, id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['environments', orgId] }); toast.success('Deleted') },
    onError: (err: any) => toast.error(err?.response?.data?.error ?? 'Cannot delete environment with active runs'),
  })

  return (
    <>
      <Topbar title="Settings" />
      <div className={s.page}>
        <h1 className={s.pageTitle}>Environments</h1>

        <div className={s.card}>
          <div className={s.sectionHeader}>
            <span className={s.sectionTitle}>Manage Environments</span>
            <button className={s.btnPrimary} onClick={() => setCreating(true)}>
              <Plus size={13} /> Add Environment
            </button>
          </div>

          <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 16 }}>
            Environments define base URLs for each sub-project. Select an environment when starting a run.
          </p>

          {creating && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, padding: '12px 14px', background: 'var(--accent-subtle)', border: '1px solid var(--accent-border)', borderRadius: 'var(--radius-md)' }}>
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Name (e.g. staging)"
                style={inputStyle}
                onKeyDown={(e) => e.key === 'Enter' && newName.trim() && createEnv.mutate()}
              />
              <input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Label (optional)"
                style={{ ...inputStyle, flex: 'none', width: 160 }}
              />
              <button
                onClick={() => createEnv.mutate()}
                disabled={!newName.trim() || createEnv.isPending}
                className={s.btnApprove}
              >
                <Check size={13} />
              </button>
              <button onClick={() => setCreating(false)} className={s.btnSecondary} style={{ height: 28, padding: '0 8px' }}>
                <X size={13} />
              </button>
            </div>
          )}

          <div className={s.tableWrap}>
            {envs.length === 0 && (
              <div style={{ textAlign: 'center', padding: '32px 16px', color: 'var(--text-muted)', fontSize: 13 }}>
                No environments yet
              </div>
            )}
            <ul style={{ listStyle: 'none' }}>
              {envs.map((env) => (
                <li key={env.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
                  {editId === env.id ? (
                    <>
                      <input value={editName} onChange={(e) => setEditName(e.target.value)} style={inputStyle} />
                      <input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} placeholder="Label" style={{ ...inputStyle, flex: 'none', width: 140 }} />
                      <button onClick={() => updateEnv.mutate(env.id)} className={s.btnApprove}><Check size={13} /></button>
                      <button onClick={() => setEditId(null)} className={s.btnSecondary} style={{ height: 26, padding: '0 8px' }}><X size={13} /></button>
                    </>
                  ) : (
                    <>
                      <div style={{ flex: 1 }}>
                        <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{env.name}</p>
                        {env.label && <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>{env.label}</p>}
                      </div>
                      <span className={envChipClass(env.name, s)}>{env.name}</span>
                      <button onClick={() => { setEditId(env.id); setEditName(env.name); setEditLabel(env.label) }} className={s.btnSecondary} style={{ height: 26, padding: '0 8px' }}>
                        <Pencil size={12} />
                      </button>
                      <button onClick={() => confirm(`Delete "${env.name}"?`) && deleteEnv.mutate(env.id)} className={s.btnDestructive}>
                        <Trash2 size={12} />
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className={s.footer}>Handcrafted by Simran · ApyHub QA · 2026</div>
      </div>
    </>
  )
}

function envChipClass(name: string, s: Record<string, string>) {
  const n = name.toLowerCase()
  if (n.includes('prod')) return s.envChipProd
  if (n.includes('stage')) return s.envChipStage
  return s.envChipDev
}
