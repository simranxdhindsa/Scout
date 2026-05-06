'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, Globe, FileText, BarChart3 } from 'lucide-react'

interface SCOSection {
  index: number
  title: string
  markdown: string
  category: string
  words: number
}

interface PhoenixResult {
  status: string
  job_id: string
  filename: string
  markdown_list: SCOSection[]
  coverage: number
  languages: string[]
  external_urls: string[]
  sco_count: number
}

interface ResultViewerProps {
  result: PhoenixResult
}

export function ResultViewer({ result }: ResultViewerProps) {
  const [activeTab, setActiveTab] = useState<'scos' | 'urls' | 'raw'>('scos')
  const [expandedSCO, setExpandedSCO] = useState<number | null>(0)

  const tabs = [
    { id: 'scos' as const, label: `SCOs (${result.sco_count ?? result.markdown_list?.length ?? 0})`, icon: <FileText size={12} /> },
    { id: 'urls' as const, label: `External URLs (${result.external_urls?.length ?? 0})`, icon: <Globe size={12} /> },
    { id: 'raw' as const, label: 'Raw JSON', icon: <BarChart3 size={12} /> },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Stats bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 24, borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', padding: '10px 20px', flexShrink: 0 }}>
        <Stat label="Coverage" value={`${Math.round(result.coverage ?? 0)}%`} color={coverageColor(result.coverage)} />
        <Stat label="SCOs" value={String(result.sco_count ?? 0)} />
        <Stat label="Languages" value={(result.languages ?? []).join(', ') || '—'} />
        <Stat label="Status" value={result.status} color={statusColor(result.status)} />
        {result.filename && <Stat label="File" value={result.filename} />}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', padding: '0 16px', flexShrink: 0 }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              height: 40,
              padding: '0 12px',
              fontSize: 12,
              fontFamily: 'inherit',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid var(--accent)' : '2px solid transparent',
              color: activeTab === tab.id ? 'var(--accent-light)' : 'var(--text-muted)',
              fontWeight: activeTab === tab.id ? 500 : 400,
              cursor: 'pointer',
              transition: 'all 150ms',
            }}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {activeTab === 'scos' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(result.markdown_list ?? []).length === 0 && (
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No SCO content extracted.</p>
            )}
            {(result.markdown_list ?? []).map((sco) => (
              <div key={sco.index} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                <button
                  onClick={() => setExpandedSCO(expandedSCO === sco.index ? null : sco.index)}
                  style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 10, background: 'var(--bg-surface)', padding: '10px 14px', cursor: 'pointer', border: 'none', textAlign: 'left' }}
                >
                  {expandedSCO === sco.index
                    ? <ChevronDown size={13} style={{ flexShrink: 0, color: 'var(--text-muted)' }} />
                    : <ChevronRight size={13} style={{ flexShrink: 0, color: 'var(--text-muted)' }} />}
                  <span style={{ flex: 1, fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {sco.index + 1}. {sco.title || `SCO ${sco.index + 1}`}
                  </span>
                  <span style={{ flexShrink: 0, fontSize: 10, color: 'var(--text-muted)' }}>{sco.words} words</span>
                  {sco.category && (
                    <span style={{ flexShrink: 0, fontSize: 10, background: 'var(--accent-subtle)', border: '1px solid var(--accent-border)', color: 'var(--accent-light)', borderRadius: 4, padding: '1px 6px' }}>
                      {sco.category}
                    </span>
                  )}
                </button>
                {expandedSCO === sco.index && (
                  <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', background: 'rgba(7,7,15,0.5)' }}>
                    <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.6, fontFamily: 'inherit', margin: 0 }}>
                      {sco.markdown || '(empty)'}
                    </pre>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {activeTab === 'urls' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {(result.external_urls ?? []).length === 0 && (
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No external URLs found.</p>
            )}
            {(result.external_urls ?? []).map((url, i) => (
              <a
                key={i}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', fontSize: 12, color: 'var(--accent-light)', textDecoration: 'none', borderRadius: 'var(--radius-sm)', wordBreak: 'break-all' }}
              >
                <Globe size={11} style={{ flexShrink: 0 }} />
                {url}
              </a>
            ))}
          </div>
        )}

        {activeTab === 'raw' && (
          <pre style={{ background: '#07070f', borderRadius: 'var(--radius-lg)', padding: 16, fontSize: 11, color: '#34d399', overflow: 'auto', lineHeight: 1.6, fontFamily: 'JetBrains Mono, monospace' }}>
            {JSON.stringify(result, null, 2)}
          </pre>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <p style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>{label}</p>
      <p style={{ fontSize: 12, fontWeight: 600, color: color ?? 'var(--text-primary)' }}>{value}</p>
    </div>
  )
}

function coverageColor(pct: number): string {
  if (pct >= 80) return 'var(--passed)'
  if (pct >= 50) return 'var(--skipped)'
  return 'var(--failed)'
}

function statusColor(status: string): string {
  if (status === 'complete') return 'var(--passed)'
  if (status === 'error' || status === 'failed') return 'var(--failed)'
  return 'var(--skipped)'
}
