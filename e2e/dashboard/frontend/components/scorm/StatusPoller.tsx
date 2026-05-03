'use client'

import { useEffect, useState } from 'react'
import { Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react'
import { scormApi } from '@/lib/api'

interface StatusPollerProps {
  orgId: string
  snapshotId: string
  initialStatus?: string
  onComplete?: (status: string) => void
}

const TERMINAL = new Set(['complete', 'error', 'failed', 'timeout'])
const POLL_MS = 3000

export function StatusPoller({ orgId, snapshotId, initialStatus = 'pending', onComplete }: StatusPollerProps) {
  const [status, setStatus] = useState(initialStatus)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (TERMINAL.has(status)) return
    const id = setInterval(() => setElapsed((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [status])

  useEffect(() => {
    if (TERMINAL.has(status)) return

    let cancelled = false
    const poll = async () => {
      try {
        const res = await scormApi.getSnapshot(orgId, snapshotId)
        const newStatus: string = res.data?.status ?? status
        if (!cancelled) {
          setStatus(newStatus)
          if (TERMINAL.has(newStatus)) {
            onComplete?.(newStatus)
          }
        }
      } catch {
        // Transient error — keep polling
      }
    }

    poll()
    const id = setInterval(poll, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [orgId, snapshotId, status, onComplete])

  const formatElapsed = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`
  }

  const isError = status === 'error' || status === 'failed'
  const isComplete = status === 'complete'
  const isTimeout = status === 'timeout'
  const isActive = !TERMINAL.has(status)

  const containerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 16px',
    borderRadius: 'var(--radius-md)',
    border: isComplete ? '1px solid rgba(52,211,153,0.25)'
      : isError ? '1px solid rgba(248,113,113,0.25)'
      : isTimeout ? '1px solid rgba(251,191,36,0.25)'
      : '1px solid rgba(56,189,248,0.25)',
    background: isComplete ? 'rgba(52,211,153,0.06)'
      : isError ? 'rgba(248,113,113,0.06)'
      : isTimeout ? 'rgba(251,191,36,0.06)'
      : 'rgba(56,189,248,0.06)',
  }

  const textColor = isComplete ? 'var(--passed)'
    : isError ? 'var(--failed)'
    : isTimeout ? 'var(--skipped)'
    : 'var(--running)'

  return (
    <div style={containerStyle}>
      <StatusIcon status={status} />

      <div style={{ flex: 1 }}>
        <p style={{ fontSize: 12, fontWeight: 500, color: textColor }}>
          {statusLabel(status)}
        </p>
        {isActive && (
          <p style={{ fontSize: 11, color: 'var(--running)', marginTop: 2 }}>
            Elapsed: {formatElapsed(elapsed)} · Polling every {POLL_MS / 1000}s
          </p>
        )}
      </div>

      {isActive && (
        <div style={{ display: 'flex', gap: 3 }}>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--running)', animation: 'pulse-dot 2s ease-in-out infinite', animationDelay: `${i * 0.3}s`, display: 'inline-block' }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'complete') return <CheckCircle2 size={16} style={{ flexShrink: 0, color: 'var(--passed)' }} />
  if (status === 'error' || status === 'failed') return <XCircle size={16} style={{ flexShrink: 0, color: 'var(--failed)' }} />
  if (status === 'timeout') return <Clock size={16} style={{ flexShrink: 0, color: 'var(--skipped)' }} />
  return <Loader2 size={16} style={{ flexShrink: 0, color: 'var(--running)', animation: 'spin 0.8s linear infinite' }} />
}

function statusLabel(status: string): string {
  switch (status) {
    case 'pending':    return 'Waiting in Phoenix queue…'
    case 'processing': return 'Phoenix is scraping the SCORM package…'
    case 'complete':   return 'Scraping complete'
    case 'error':      return 'Phoenix returned an error'
    case 'failed':     return 'Scraping failed'
    case 'timeout':    return 'Timed out after 10 minutes'
    default:           return `Status: ${status}`
  }
}
