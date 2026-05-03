'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '@/lib/api'
import { Topbar } from '@/components/layout/Topbar'
import { Plus, Pencil, Check, X, Building2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import toast from 'react-hot-toast'
import s from '../Admin.module.css'

interface Org {
  id: string
  name: string
  slug: string
  is_active: boolean
  created_at: string
}

const inputStyle: React.CSSProperties = {
  height: 32,
  padding: '0 10px',
  background: 'rgba(7,7,15,0.8)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  fontSize: 12,
  color: 'var(--text-primary)',
  fontFamily: 'Inter, sans-serif',
  outline: 'none',
  flex: 1,
}

export default function AdminOrgsPage() {
  const qc = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newSlug, setNewSlug] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editSlug, setEditSlug] = useState('')
  const [editActive, setEditActive] = useState(true)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-orgs'],
    queryFn: () => adminApi.listOrgs().then((r) => r.data),
  })

  const orgs: Org[] = data?.orgs ?? []

  const createOrg = useMutation({
    mutationFn: () => adminApi.createOrg({ name: newName, slug: newSlug }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-orgs'] })
      toast.success('Organisation created')
      setCreating(false)
      setNewName('')
      setNewSlug('')
    },
    onError: () => toast.error('Failed to create (slug may be taken)'),
  })

  const updateOrg = useMutation({
    mutationFn: (id: string) =>
      adminApi.updateOrg(id, { name: editName, slug: editSlug, is_active: editActive }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-orgs'] })
      toast.success('Updated')
      setEditId(null)
    },
    onError: () => toast.error('Update failed'),
  })

  return (
    <>
      <Topbar
        title="Organisations"
        actions={
          <button onClick={() => setCreating(true)} className={s.btnPrimary}>
            <Plus size={13} /> New Org
          </button>
        }
      />

      <div className={s.content}>
        <div style={{ maxWidth: 860, margin: '0 auto' }}>

          {creating && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', marginBottom: 16, background: 'var(--accent-subtle)', border: '1px solid var(--accent-border)', borderRadius: 'var(--radius-md)' }}>
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Organisation name"
                style={inputStyle}
              />
              <input
                value={newSlug}
                onChange={(e) => setNewSlug(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
                placeholder="slug"
                style={{ ...inputStyle, flex: 'none', width: 160 }}
              />
              <button
                onClick={() => createOrg.mutate()}
                disabled={!newName.trim() || !newSlug.trim() || createOrg.isPending}
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
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Organisation</th>
                  <th>Slug</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={5} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>Loading…</td></tr>
                )}
                {!isLoading && orgs.length === 0 && (
                  <tr><td colSpan={5} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>No organisations yet</td></tr>
                )}
                {orgs.map((org) => (
                  <tr key={org.id}>
                    {editId === org.id ? (
                      <>
                        <td>
                          <input value={editName} onChange={(e) => setEditName(e.target.value)} style={{ ...inputStyle, flex: 'none', width: '100%' }} />
                        </td>
                        <td>
                          <input value={editSlug} onChange={(e) => setEditSlug(e.target.value)} style={{ ...inputStyle, flex: 'none', width: '100%' }} />
                        </td>
                        <td>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                            <input type="checkbox" checked={editActive} onChange={(e) => setEditActive(e.target.checked)} style={{ accentColor: 'var(--accent)' }} />
                            Active
                          </label>
                        </td>
                        <td />
                        <td>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button onClick={() => updateOrg.mutate(org.id)} className={s.btnApprove}><Check size={13} /></button>
                            <button onClick={() => setEditId(null)} className={s.btnSecondary} style={{ height: 26, padding: '0 8px' }}><X size={13} /></button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Building2 size={13} style={{ color: 'var(--accent-light)', flexShrink: 0 }} />
                            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{org.name}</span>
                          </div>
                        </td>
                        <td style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--text-muted)' }}>{org.slug}</td>
                        <td>
                          <span className={org.is_active ? s.badgeActive : s.badgeInactive}>
                            {org.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          {formatDistanceToNow(new Date(org.created_at), { addSuffix: true })}
                        </td>
                        <td>
                          <button
                            onClick={() => { setEditId(org.id); setEditName(org.name); setEditSlug(org.slug); setEditActive(org.is_active) }}
                            className={s.btnSecondary}
                            style={{ height: 26, padding: '0 8px' }}
                          >
                            <Pencil size={12} />
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={s.footer}>Handcrafted by Simran · ApyHub QA · 2026</div>
        </div>
      </div>
    </>
  )
}
