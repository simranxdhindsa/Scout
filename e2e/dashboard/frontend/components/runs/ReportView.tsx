'use client'

import { CheckCircle2, XCircle, Clock, SkipForward, AlertTriangle } from 'lucide-react'

interface RunReport {
  passed: number
  failed: number
  skipped: number
  timed_out: number
  total: number
  duration_ms: number
  console_errors: number
  api_errors: number
  failed_requests: number
  page_errors: number
  report_url?: string
}

interface RunItem {
  id: string
  test_case_name: string
  status: string
  duration_ms?: number
  error_message?: string
  error_stack?: string
  retry_count: number
}

interface ReportViewProps {
  report: RunReport
  items: RunItem[]
}

export function ReportView({ report, items }: ReportViewProps) {
  const passRate = report.total > 0
    ? Math.round((report.passed / report.total) * 100)
    : 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <StatCard label="Passed"   value={report.passed}   color="passed" icon={<CheckCircle2 size={14} />} />
        <StatCard label="Failed"   value={report.failed}   color="failed" icon={<XCircle size={14} />} />
        <StatCard label="Skipped"  value={report.skipped}  color="neutral" icon={<SkipForward size={14} />} />
        <StatCard label="Timed Out" value={report.timed_out} color="skipped" icon={<Clock size={14} />} />
      </div>

      {/* Pass rate + duration */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '12px 20px' }}>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Pass Rate</p>
          <p style={{ fontSize: 24, fontWeight: 700, color: passRate >= 80 ? 'var(--passed)' : passRate >= 50 ? 'var(--skipped)' : 'var(--failed)' }}>
            {passRate}%
          </p>
        </div>
        <div style={{ width: 1, height: 40, background: 'var(--border)', margin: '0 20px' }} />
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Duration</p>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
            {report.duration_ms ? formatDuration(report.duration_ms) : '—'}
          </p>
        </div>
        <div style={{ width: 1, height: 40, background: 'var(--border)', margin: '0 20px' }} />
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Total Tests</p>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{report.total}</p>
        </div>

        {report.report_url && (
          <a
            href={report.report_url}
            target="_blank"
            rel="noopener noreferrer"
            style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--accent-light)', textDecoration: 'none', padding: '6px 12px', border: '1px solid var(--accent-border)', borderRadius: 'var(--radius-md)' }}
          >
            HTML Report ↗
          </a>
        )}
      </div>

      {/* Browser/network errors */}
      {(report.console_errors > 0 || report.failed_requests > 0 || report.page_errors > 0) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: 'var(--radius-md)' }}>
          <AlertTriangle size={14} style={{ color: 'var(--skipped)', flexShrink: 0 }} />
          <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--skipped)' }}>
            {report.console_errors > 0 && <span>{report.console_errors} console errors</span>}
            {report.failed_requests > 0 && <span>{report.failed_requests} failed requests</span>}
            {report.page_errors > 0 && <span>{report.page_errors} page errors</span>}
          </div>
        </div>
      )}

      {/* Test results table */}
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border-strong)' }}>
              {['Test', 'Status', 'Duration', 'Retries'].map((h) => (
                <th key={h} style={{ padding: '10px 16px', fontSize: 11, fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'left' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '12px 16px' }}>
                  <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{item.test_case_name || '—'}</p>
                  {item.error_message && (
                    <p style={{ marginTop: 4, fontSize: 11, color: 'var(--failed)', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{item.error_message}</p>
                  )}
                </td>
                <td style={{ padding: '12px 16px' }}>
                  <StatusBadge status={item.status} />
                </td>
                <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-muted)' }}>
                  {item.duration_ms != null ? formatDuration(item.duration_ms) : '—'}
                </td>
                <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-muted)' }}>
                  {item.retry_count > 0 ? `${item.retry_count}×` : '—'}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={4} style={{ padding: '32px 16px', textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
                  No test results yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

type CardColor = 'passed' | 'failed' | 'neutral' | 'skipped'

function StatCard({ label, value, color, icon }: {
  label: string
  value: number
  color: CardColor
  icon: React.ReactNode
}) {
  const styles: Record<CardColor, React.CSSProperties> = {
    passed:  { background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.20)', color: 'var(--passed)' },
    failed:  { background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.20)', color: 'var(--failed)' },
    neutral: { background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', color: 'var(--text-secondary)' },
    skipped: { background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.20)', color: 'var(--skipped)' },
  }
  return (
    <div style={{ ...styles[color], borderRadius: 'var(--radius-lg)', padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 500, opacity: 0.75, marginBottom: 6 }}>
        {icon}
        {label}
      </div>
      <p style={{ fontSize: 24, fontWeight: 700 }}>{value}</p>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, React.CSSProperties> = {
    passed:  { background: 'rgba(52,211,153,0.12)', color: 'var(--passed)', border: '1px solid rgba(52,211,153,0.25)' },
    failed:  { background: 'rgba(248,113,113,0.12)', color: 'var(--failed)', border: '1px solid rgba(248,113,113,0.25)' },
    skipped: { background: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)', border: '1px solid var(--border-strong)' },
    timedOut:{ background: 'rgba(251,191,36,0.12)', color: 'var(--skipped)', border: '1px solid rgba(251,191,36,0.25)' },
    queued:  { background: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)', border: '1px solid var(--border-strong)' },
    running: { background: 'rgba(56,189,248,0.12)', color: 'var(--running)', border: '1px solid rgba(56,189,248,0.25)' },
  }
  const style = map[status] ?? map.queued
  return (
    <span style={{ ...style, borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 500 }}>
      {status}
    </span>
  )
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  const sec = Math.floor((ms % 60_000) / 1000)
  return `${m}m ${sec}s`
}
