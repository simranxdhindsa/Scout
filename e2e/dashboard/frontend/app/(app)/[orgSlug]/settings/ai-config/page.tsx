'use client'

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { aiApi } from '@/lib/api'
import { Topbar } from '@/components/layout/Topbar'
import { Save, Bot } from 'lucide-react'
import { useCurrentOrg } from '@/lib/auth'
import toast from 'react-hot-toast'
import s from '../Settings.module.css'

interface PageProps { params: { orgSlug: string } }

const MODELS = [
  'llama-3.3-70b-versatile',
  'llama-3.1-70b-versatile',
  'llama-3.1-8b-instant',
  'mixtral-8x7b-32768',
]

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  background: 'rgba(7,7,15,0.8)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  fontSize: 13,
  color: 'var(--text-primary)',
  fontFamily: 'Inter, sans-serif',
  outline: 'none',
}

export default function AIConfigPage({ params }: PageProps) {
  const { orgSlug } = params
  const org = useCurrentOrg(orgSlug)
  const orgId = org?.id ?? ''
  const qc = useQueryClient()

  const [systemPrompt, setSystemPrompt] = useState('')
  const [model, setModel] = useState(MODELS[0])
  const [temperature, setTemperature] = useState(0.7)
  const [maxTokens, setMaxTokens] = useState(2048)
  const [ragEnabled, setRagEnabled] = useState(true)
  const [isDirty, setIsDirty] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['ai-config', orgId],
    queryFn: () => aiApi.getConfig(orgId).then((r) => r.data),
    enabled: !!orgId,
  })

  useEffect(() => {
    if (data) {
      setSystemPrompt(data.system_prompt ?? '')
      setModel(data.model ?? MODELS[0])
      setTemperature(data.temperature ?? 0.7)
      setMaxTokens(data.max_tokens ?? 2048)
      setRagEnabled(data.rag_enabled ?? true)
      setIsDirty(false)
    }
  }, [data])

  const save = useMutation({
    mutationFn: () =>
      aiApi.updateConfig(orgId, { system_prompt: systemPrompt, model, temperature, max_tokens: maxTokens, rag_enabled: ragEnabled }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ai-config', orgId] })
      toast.success('AI config saved')
      setIsDirty(false)
    },
    onError: () => toast.error('Failed to save config'),
  })

  const mark = () => setIsDirty(true)

  return (
    <>
      <Topbar title="Settings" />
      <div className={s.page}>
        <h1 className={s.pageTitle}>AI Configuration</h1>

        {isLoading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
            <div style={{ width: 20, height: 20, border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
          </div>
        ) : (
          <div className={s.card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
              <div style={{ width: 40, height: 40, borderRadius: 'var(--radius-lg)', background: 'var(--accent-subtle)', border: '1px solid var(--accent-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent-light)', flexShrink: 0 }}>
                <Bot size={20} />
              </div>
              <div>
                <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Scout AI Settings</p>
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Configure the AI assistant for your organisation</p>
              </div>
            </div>

            {/* System prompt */}
            <div style={{ marginBottom: 20 }}>
              <label className={s.label}>System Prompt</label>
              <textarea
                value={systemPrompt}
                onChange={(e) => { setSystemPrompt(e.target.value); mark() }}
                rows={6}
                placeholder="You are a QA expert for [Company]. Focus on..."
                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}
              />
              <p style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)' }}>
                Leave blank to use Scout's default QA-focused system prompt.
              </p>
            </div>

            {/* Model */}
            <div style={{ marginBottom: 20 }}>
              <label className={s.label}>Model</label>
              <select
                value={model}
                onChange={(e) => { setModel(e.target.value); mark() }}
                style={inputStyle}
              >
                {MODELS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            {/* Temperature + max tokens */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
              <div>
                <label className={s.label}>
                  Temperature <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({temperature})</span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={temperature}
                  onChange={(e) => { setTemperature(parseFloat(e.target.value)); mark() }}
                  style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  <span>Precise (0)</span>
                  <span>Creative (1)</span>
                </div>
              </div>

              <div>
                <label className={s.label}>Max Tokens</label>
                <input
                  type="number"
                  value={maxTokens}
                  min={256}
                  max={8192}
                  step={256}
                  onChange={(e) => { setMaxTokens(parseInt(e.target.value)); mark() }}
                  style={inputStyle}
                />
              </div>
            </div>

            {/* RAG toggle */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', marginBottom: 24, background: 'rgba(255,255,255,0.02)' }}>
              <div>
                <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>Context-Aware Responses (RAG)</p>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Inject relevant test history into every AI response</p>
              </div>
              <button
                onClick={() => { setRagEnabled(!ragEnabled); mark() }}
                style={{
                  position: 'relative',
                  width: 36,
                  height: 20,
                  borderRadius: 10,
                  background: ragEnabled ? 'var(--accent)' : 'rgba(255,255,255,0.12)',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'background 200ms',
                  flexShrink: 0,
                }}
              >
                <span style={{
                  position: 'absolute',
                  top: 2,
                  left: ragEnabled ? 17 : 2,
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  background: 'white',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
                  transition: 'left 200ms',
                }} />
              </button>
            </div>

            {/* Save */}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={() => save.mutate()}
                disabled={!isDirty || save.isPending}
                className={s.btnPrimary}
                style={{ opacity: (!isDirty || save.isPending) ? 0.5 : 1, cursor: (!isDirty || save.isPending) ? 'not-allowed' : 'pointer' }}
              >
                <Save size={13} />
                {save.isPending ? 'Saving…' : 'Save Config'}
              </button>
            </div>
          </div>
        )}

        <div className={s.footer}>Handcrafted by Simran · ApyHub QA · 2026</div>
      </div>
    </>
  )
}
