'use client'

import { useState } from 'react'
import { Download, Upload, CheckCircle2, AlertTriangle, Zap } from 'lucide-react'
import { scormApi } from '@/lib/api'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { getAuthToken } from '@/lib/auth'

interface Generator {
  id: string
  type_key: string
  name: string
  category: 'valid' | 'edge' | 'break'
  description: string
  expected: string
  filename: string
  is_active: boolean
  sort_order: number
}

interface GeneratorGridProps {
  orgId: string
  onGenerated?: (snapshotId: string) => void
}

const CATEGORY_CONFIG = {
  valid: {
    label: 'Valid',
    cardStyle: { background: 'rgba(52,211,153,0.06)', border: '1px solid rgba(52,211,153,0.20)' } as React.CSSProperties,
    badgeStyle: { background: 'rgba(52,211,153,0.12)', color: 'var(--passed)', border: '1px solid rgba(52,211,153,0.25)' } as React.CSSProperties,
    headerColor: 'var(--passed)',
    icon: <CheckCircle2 size={13} />,
    description: 'Standards-compliant packages — Phoenix should handle these correctly',
  },
  edge: {
    label: 'Edge Cases',
    cardStyle: { background: 'rgba(251,191,36,0.04)', border: '1px solid rgba(251,191,36,0.18)' } as React.CSSProperties,
    badgeStyle: { background: 'rgba(251,191,36,0.12)', color: 'var(--skipped)', border: '1px solid rgba(251,191,36,0.25)' } as React.CSSProperties,
    headerColor: 'var(--skipped)',
    icon: <AlertTriangle size={13} />,
    description: 'Unusual but valid structures — tests robustness',
  },
  break: {
    label: 'Break Tests',
    cardStyle: { background: 'rgba(248,113,113,0.04)', border: '1px solid rgba(248,113,113,0.18)' } as React.CSSProperties,
    badgeStyle: { background: 'rgba(248,113,113,0.12)', color: 'var(--failed)', border: '1px solid rgba(248,113,113,0.25)' } as React.CSSProperties,
    headerColor: 'var(--failed)',
    icon: <Zap size={13} />,
    description: 'Malicious or malformed packages — Phoenix should reject or handle safely',
  },
}

export function GeneratorGrid({ orgId, onGenerated }: GeneratorGridProps) {
  const [activeCategory, setActiveCategory] = useState<'all' | 'valid' | 'edge' | 'break'>('all')
  const [runningKeys, setRunningKeys] = useState<Set<string>>(new Set())

  const { data } = useQuery({
    queryKey: ['generators', orgId],
    queryFn: () => scormApi.listGenerators(orgId).then((r) => r.data),
  })

  const generators: Generator[] = data?.generators ?? []

  const filtered = activeCategory === 'all'
    ? generators
    : generators.filter((g) => g.category === activeCategory)

  const grouped = {
    valid: filtered.filter((g) => g.category === 'valid'),
    edge: filtered.filter((g) => g.category === 'edge'),
    break: filtered.filter((g) => g.category === 'break'),
  }

  const handleDownload = (typeKey: string, filename: string) => {
    const token = getAuthToken()
    const url = scormApi.generate(orgId, typeKey) + (token ? `?token=${token}` : '')
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
  }

  const handleRunTest = async (gen: Generator) => {
    setRunningKeys((prev) => new Set([...prev, gen.type_key]))
    try {
      const token = getAuthToken()
      const url = scormApi.generate(orgId, gen.type_key) + (token ? `?token=${token}` : '')
      const resp = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!resp.ok) throw new Error('Generate failed')

      const blob = await resp.blob()
      const formData = new FormData()
      formData.append('file', blob, gen.filename)

      const uploadResp = await scormApi.upload(orgId, formData)
      const { snapshot_id } = uploadResp.data

      toast.success(`${gen.name} submitted to Phoenix`)
      onGenerated?.(snapshot_id)
    } catch {
      toast.error(`Failed to run ${gen.name}`)
    } finally {
      setRunningKeys((prev) => {
        const next = new Set(prev)
        next.delete(gen.type_key)
        return next
      })
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Category filter */}
      <div style={{ display: 'flex', gap: 8 }}>
        {(['all', 'valid', 'edge', 'break'] as const).map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            style={{
              height: 28,
              padding: '0 12px',
              fontSize: 12,
              fontWeight: 500,
              borderRadius: 'var(--radius-full)',
              cursor: 'pointer',
              border: 'none',
              background: activeCategory === cat ? 'linear-gradient(135deg, #6366f1, #7c3aed)' : 'rgba(255,255,255,0.06)',
              color: activeCategory === cat ? 'white' : 'var(--text-muted)',
              transition: 'all 150ms',
            }}
          >
            {cat === 'all' ? `All (${generators.length})` : `${CATEGORY_CONFIG[cat].label} (${generators.filter((g) => g.category === cat).length})`}
          </button>
        ))}
      </div>

      {(['valid', 'edge', 'break'] as const).map((cat) => {
        const items = grouped[cat]
        if (items.length === 0) return null
        const cfg = CATEGORY_CONFIG[cat]

        return (
          <div key={cat}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontWeight: 600, fontSize: 14, color: cfg.headerColor }}>
                {cfg.icon}
                {cfg.label}
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>— {cfg.description}</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
              {items.map((gen) => (
                <GeneratorCard
                  key={gen.type_key}
                  gen={gen}
                  categoryConfig={cfg}
                  isRunning={runningKeys.has(gen.type_key)}
                  onDownload={() => handleDownload(gen.type_key, gen.filename)}
                  onRunTest={() => handleRunTest(gen)}
                />
              ))}
            </div>
          </div>
        )
      })}

      {filtered.length === 0 && (
        <div style={{ padding: '48px 16px', textAlign: 'center', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', color: 'var(--text-muted)', fontSize: 13 }}>
          No generators available
        </div>
      )}
    </div>
  )
}

function GeneratorCard({
  gen, categoryConfig, isRunning, onDownload, onRunTest,
}: {
  gen: Generator
  categoryConfig: typeof CATEGORY_CONFIG['valid']
  isRunning: boolean
  onDownload: () => void
  onRunTest: () => void
}) {
  return (
    <div style={{
      ...categoryConfig.cardStyle,
      borderRadius: 'var(--radius-lg)',
      padding: '16px',
      opacity: gen.is_active ? 1 : 0.5,
      transition: 'box-shadow 150ms',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3 }}>{gen.name}</h3>
        <span style={{ ...categoryConfig.badgeStyle, borderRadius: 4, padding: '2px 7px', fontSize: 10, fontWeight: 500, flexShrink: 0 }}>
          {categoryConfig.label}
        </span>
      </div>

      <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 10, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
        {gen.description}
      </p>

      {gen.expected && (
        <p style={{ fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic', padding: '6px 10px', background: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-sm)', marginBottom: 12, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
          Expected: {gen.expected}
        </p>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          onClick={onDownload}
          disabled={!gen.is_active}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: gen.is_active ? 'pointer' : 'not-allowed', padding: '4px 6px', borderRadius: 4 }}
          title="Download zip"
        >
          <Download size={11} /> Download
        </button>

        <button
          onClick={onRunTest}
          disabled={!gen.is_active || isRunning}
          style={{
            marginLeft: 'auto',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 5,
            height: 26,
            padding: '0 10px',
            fontSize: 11,
            fontWeight: 500,
            borderRadius: 'var(--radius-sm)',
            border: 'none',
            cursor: (gen.is_active && !isRunning) ? 'pointer' : 'not-allowed',
            background: (gen.is_active && !isRunning) ? 'linear-gradient(135deg, #6366f1, #7c3aed)' : 'rgba(255,255,255,0.06)',
            color: (gen.is_active && !isRunning) ? 'white' : 'var(--text-muted)',
          }}
        >
          {isRunning ? (
            <>
              <div style={{ width: 10, height: 10, border: '2px solid white', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
              Running…
            </>
          ) : (
            <>
              <Upload size={11} />
              Run Test
            </>
          )}
        </button>
      </div>
    </div>
  )
}
