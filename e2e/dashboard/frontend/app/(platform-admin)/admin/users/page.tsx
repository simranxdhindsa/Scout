'use client'

import { useQuery } from '@tanstack/react-query'
import { adminApi } from '@/lib/api'
import { Topbar } from '@/components/layout/Topbar'
import { formatDistanceToNow } from 'date-fns'
import { Users } from 'lucide-react'
import s from '../Admin.module.css'

interface User {
  id: string
  email: string
  name: string
  avatar_url: string
  created_at: string
}

export default function AdminUsersPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => adminApi.listUsers().then((r) => r.data),
  })

  const users: User[] = data?.users ?? []

  return (
    <>
      <Topbar title="Users" />
      <div className={s.content}>
        <div style={{ maxWidth: 860, margin: '0 auto' }}>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              All users who have authenticated via Google OAuth.
            </p>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 20, padding: '3px 10px' }}>
              {users.length} total
            </span>
          </div>

          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Email</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr>
                    <td colSpan={3} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                        <div style={{ width: 14, height: 14, border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                        Loading…
                      </div>
                    </td>
                  </tr>
                )}
                {!isLoading && users.length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ textAlign: 'center', padding: 48, color: 'var(--text-muted)' }}>
                      <Users size={24} style={{ margin: '0 auto 8px', opacity: 0.3 }} />
                      <p style={{ fontSize: 13 }}>No users yet</p>
                    </td>
                  </tr>
                )}
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {user.avatar_url ? (
                          <img src={user.avatar_url} alt={user.name} style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }} />
                        ) : (
                          <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--accent-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: 'var(--accent-light)' }}>
                            {user.name?.[0]?.toUpperCase() ?? '?'}
                          </div>
                        )}
                        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{user.name || '—'}</span>
                      </div>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{user.email}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {formatDistanceToNow(new Date(user.created_at), { addSuffix: true })}
                    </td>
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
