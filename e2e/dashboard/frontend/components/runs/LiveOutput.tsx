'use client'

import { useEffect, useRef, useState } from 'react'
import { useRunStream, StreamMessage } from '@/lib/ws'
import { Terminal, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react'

interface LogLine {
  id: number
  type: StreamMessage['type']
  text: string
  time: string
}

interface LiveOutputProps {
  orgId: string
  runId: string
  initialStatus?: string
  onStatusChange?: (status: string) => void
}

export function LiveOutput({ orgId, runId, initialStatus, onStatusChange }: LiveOutputProps) {
  const [lines, setLines] = useState<LogLine[]>([])
  const [status, setStatus] = useState(initialStatus ?? 'running')
  const [autoScroll, setAutoScroll] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)
  const counterRef = useRef(0)

  const isActive = status === 'running' || status === 'queued'

  useRunStream(orgId, runId, (msg) => {
    if (msg.type === 'status') {
      setStatus(msg.payload)
      onStatusChange?.(msg.payload)
      return
    }
    if (msg.type === 'done') return

    setLines((prev) => [
      ...prev,
      { id: counterRef.current++, type: msg.type, text: msg.payload, time: msg.time },
    ])
  }, isActive)

  useEffect(() => {
    if (autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [lines, autoScroll])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', background: '#07070f', fontFamily: 'JetBrains Mono, monospace' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.07)', padding: '8px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Terminal size={13} style={{ color: 'rgba(255,255,255,0.3)' }} />
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>Live Output</span>
          <StatusPill status={status} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'rgba(255,255,255,0.35)', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              style={{ width: 12, height: 12, accentColor: 'var(--accent)' }}
            />
            Auto-scroll
          </label>
          <button
            onClick={() => setLines([])}
            style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            Clear
          </button>
        </div>
      </div>

      {/* Log lines */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', fontSize: 12, lineHeight: 1.6 }}>
        {lines.length === 0 && isActive && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'rgba(255,255,255,0.25)' }}>
            <Loader2 size={12} style={{ animation: 'spin 0.8s linear infinite' }} />
            <span>Waiting for output…</span>
          </div>
        )}

        {lines.map((line) => (
          <div key={line.id} style={{ display: 'flex', gap: 12, color: lineColor(line.type) }}>
            <span style={{ flexShrink: 0, color: 'rgba(255,255,255,0.18)', fontSize: 10, marginTop: 1 }}>
              {new Date(line.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
            <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{line.text}</span>
          </div>
        ))}

        <div ref={bottomRef} />
      </div>

      {/* Done banner */}
      {(status === 'done' || status === 'failed' || status === 'stopped') && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 16px',
          fontSize: 12,
          borderTop: status === 'done' ? '1px solid rgba(52,211,153,0.2)' : '1px solid rgba(248,113,113,0.2)',
          background: status === 'done' ? 'rgba(52,211,153,0.06)' : 'rgba(248,113,113,0.06)',
          color: status === 'done' ? 'var(--passed)' : 'var(--failed)',
        }}>
          {status === 'done' ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
          Run {status}
        </div>
      )}
    </div>
  )
}

function lineColor(type: StreamMessage['type']): string {
  switch (type) {
    case 'stderr': return '#f87171'
    case 'error':  return '#ef4444'
    case 'status': return '#fbbf24'
    default:       return 'rgba(255,255,255,0.78)'
  }
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, React.CSSProperties> = {
    queued:  { background: 'rgba(100,116,139,0.2)', color: '#94a3b8' },
    running: { background: 'rgba(251,191,36,0.15)', color: '#fbbf24' },
    done:    { background: 'rgba(52,211,153,0.15)', color: '#34d399' },
    failed:  { background: 'rgba(248,113,113,0.15)', color: '#f87171' },
    stopped: { background: 'rgba(192,132,252,0.15)', color: '#c084fc' },
  }
  const style = map[status] ?? map.queued
  return (
    <span style={{ ...style, borderRadius: 4, padding: '1px 7px', fontSize: 10, fontWeight: 500 }}>
      {status}
    </span>
  )
}
