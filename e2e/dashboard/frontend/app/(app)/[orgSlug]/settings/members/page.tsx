'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { membersApi } from '@/lib/api'
import { Topbar } from '@/components/layout/Topbar'
import { Plus, Trash2, Shield, User } from 'lucide-react'
import { useCurrentOrg, useAuthStore } from '@/lib/auth'
import toast from 'react-hot-toast'
import s from '../Settings.module.css'

interface PageProps { params: { orgSlug: string } }

interface Member {
  id: string
  user_id: string
  role: 'admin' | 'member'
  user_name: string
  user_email: string
  avatar_url: string
}

const inputStyle: React.CSSProperties = {
  height: 34,
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

const selectStyle: React.CSSProperties = {
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

export default function MembersPage({ params }: PageProps) {
  const { orgSlug } = params
  const org = useCurrentOrg(orgSlug)
  const orgId = org?.id ?? ''
  const { user } = useAuthStore()
  const qc = useQueryClient()

  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'member'>('member')
  const [adding, setAdding] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['members', orgId],
    queryFn: () => membersApi.list(orgId).then((r) => r.data),
    enabled: !!orgId,
  })

  const members: Member[] = data?.members ?? []

  const addMember = useMutation({
    mutationFn: () => membersApi.add(orgId, { email, role }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['members', orgId] })
      toast.success('Member added')
      setEmail('')
      setAdding(false)
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.error ?? 'Failed to add member'),
  })

  const updateRole = useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: string }) =>
      membersApi.update(orgId, memberId, { role }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['members', orgId] })
      toast.success('Role updated')
    },
  })

  const removeMember = useMutation({
    mutationFn: (memberId: string) => membersApi.remove(orgId, memberId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['members', orgId] })
      toast.success('Member removed')
    },
    onError: () => toast.error('Failed to remove member'),
  })

  return (
    <>
      <Topbar title="Settings" />
      <div className={s.page}>
        <h1 className={s.pageTitle}>Members</h1>

        <div className={s.card}>
          <div className={s.sectionHeader}>
            <span className={s.sectionTitle}>Team Members</span>
            {!adding && (
              <button onClick={() => setAdding(true)} className={s.btnPrimary}>
                <Plus size={13} /> Add Member
              </button>
            )}
          </div>

          {adding && (
            <div style={{ marginBottom: 16, padding: '14px 16px', background: 'var(--accent-subtle)', border: '1px solid var(--accent-border)', borderRadius: 'var(--radius-md)' }}>
              <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 10 }}>Invite Member</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  autoFocus
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="user@company.com"
                  style={inputStyle}
                />
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as any)}
                  style={{ ...selectStyle, flex: 'none', width: 120 }}
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
                <button
                  onClick={() => addMember.mutate()}
                  disabled={!email.trim() || addMember.isPending}
                  className={s.btnPrimary}
                >
                  {addMember.isPending ? 'Adding…' : 'Add'}
                </button>
                <button onClick={() => setAdding(false)} className={s.btnSecondary} style={{ height: 34 }}>
                  Cancel
                </button>
              </div>
              <p style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                The user must have signed in with Google at least once.
              </p>
            </div>
          )}

          {isLoading && (
            <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>Loading…</div>
          )}

          {!isLoading && members.length === 0 && (
            <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)', fontSize: 13 }}>No members yet</div>
          )}

          <ul style={{ listStyle: 'none' }}>
            {members.map((m) => {
              const isMe = m.user_id === user?.id
              return (
                <li key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                  {m.avatar_url ? (
                    <img src={m.avatar_url} alt={m.user_name} style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }} />
                  ) : (
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--accent-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: 'var(--accent-light)', flexShrink: 0 }}>
                      {m.user_name?.[0]?.toUpperCase() ?? '?'}
                    </div>
                  )}

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {m.user_name}
                      {isMe && <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--text-muted)' }}>(you)</span>}
                    </p>
                    <p style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.user_email}</p>
                  </div>

                  <select
                    value={m.role}
                    disabled={isMe}
                    onChange={(e) => updateRole.mutate({ memberId: m.id, role: e.target.value })}
                    style={{ ...selectStyle, flex: 'none', width: 110, opacity: isMe ? 0.5 : 1, cursor: isMe ? 'not-allowed' : 'pointer' }}
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>

                  <div style={{ width: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {m.role === 'admin'
                      ? <Shield size={13} style={{ color: 'var(--accent-light)' }} />
                      : <User size={13} style={{ color: 'var(--text-muted)' }} />}
                  </div>

                  <button
                    onClick={() => confirm(`Remove ${m.user_name}?`) && removeMember.mutate(m.id)}
                    disabled={isMe}
                    className={s.btnDestructive}
                    title={isMe ? "Can't remove yourself" : 'Remove member'}
                    style={{ opacity: isMe ? 0.3 : 1, cursor: isMe ? 'not-allowed' : 'pointer' }}
                  >
                    <Trash2 size={12} />
                  </button>
                </li>
              )
            })}
          </ul>
        </div>

        <div className={s.footer}>Handcrafted by Simran · ApyHub QA · 2026</div>
      </div>
    </>
  )
}
