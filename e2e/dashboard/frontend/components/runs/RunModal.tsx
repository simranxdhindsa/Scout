'use client'

import { useState } from 'react'
import { X, Play, Eye, EyeOff } from 'lucide-react'
import { runsApi, environmentsApi } from '@/lib/api'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'

interface RunModalProps {
  orgId: string
  orgSlug: string
  targetType: 'test_case' | 'folder'
  targetIds: string[]
  targetLabel: string
  onClose: () => void
  onStarted?: (runId: string) => void
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  height: 36,
  padding: '0 12px',
  background: 'rgba(7,7,15,0.8)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  fontSize: 13,
  color: 'var(--text-primary)',
  fontFamily: 'Inter, sans-serif',
  outline: 'none',
}

export function RunModal({ orgId, orgSlug, targetType, targetIds, targetLabel, onClose, onStarted }: RunModalProps) {
  const qc = useQueryClient()
  const [envId, setEnvId] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [label, setLabel] = useState('')

  const { data: envsData } = useQuery({
    queryKey: ['environments', orgId],
    queryFn: () => environmentsApi.list(orgId).then((r) => r.data),
  })

  const envs: { id: string; name: string; label: string }[] = envsData?.environments ?? []

  const mutation = useMutation({
    mutationFn: () =>
      runsApi.start(orgId, {
        target_type: targetType,
        target_ids: targetIds,
        environment_id: envId || undefined,
        credentials: email ? { email, password } : undefined,
        label: label || undefined,
      }),
    onSuccess: (res) => {
      toast.success('Run started')
      qc.invalidateQueries({ queryKey: ['runs', orgId] })
      onStarted?.(res.data.run_id)
      onClose()
    },
    onError: () => toast.error('Failed to start run'),
  })

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}>
      <div style={{ width: '100%', maxWidth: 440, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-xl)', boxShadow: '0 24px 80px rgba(0,0,0,0.6)', animation: 'fade-in 150ms ease' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', padding: '16px 20px' }}>
          <div>
            <h2 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Start Run</h2>
            <p style={{ marginTop: 2, fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300 }}>{targetLabel}</p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: 4 }}>
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Label */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 6 }}>
              Run label <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span>
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Regression — Sprint 42"
              style={inputStyle}
            />
          </div>

          {/* Environment */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 6 }}>Environment</label>
            <select value={envId} onChange={(e) => setEnvId(e.target.value)} style={inputStyle}>
              <option value="">No environment override</option>
              {envs.map((e) => (
                <option key={e.id} value={e.id}>{e.label || e.name}</option>
              ))}
            </select>
          </div>

          {/* Credentials */}
          <div style={{ padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'rgba(255,255,255,0.02)' }}>
            <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 10 }}>
              Credentials <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional — cleared after run starts)</span>
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email / username"
                style={inputStyle}
              />
              <div style={{ position: 'relative' }}>
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  style={{ ...inputStyle, paddingRight: 36 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}
                >
                  {showPw ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, borderTop: '1px solid var(--border)', padding: '12px 20px' }}>
          <button
            onClick={onClose}
            style={{ height: 32, padding: '0 14px', fontSize: 13, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', borderRadius: 'var(--radius-md)' }}
          >
            Cancel
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              height: 32,
              padding: '0 16px',
              fontSize: 13,
              fontWeight: 500,
              color: 'white',
              background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 60%, #7c3aed 100%)',
              border: '1px solid rgba(99,102,241,0.40)',
              boxShadow: '0 0 14px rgba(99,102,241,0.30)',
              borderRadius: 'var(--radius-md)',
              cursor: mutation.isPending ? 'not-allowed' : 'pointer',
              opacity: mutation.isPending ? 0.6 : 1,
            }}
          >
            <Play size={12} />
            {mutation.isPending ? 'Starting…' : 'Start Run'}
          </button>
        </div>
      </div>
    </div>
  )
}
