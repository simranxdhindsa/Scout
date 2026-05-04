'use client'

import { useState, useEffect } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { oneDark } from '@codemirror/theme-one-dark'
import { Save, History, Play, AlertCircle, CheckCircle2, RefreshCw } from 'lucide-react'
import { testsApi } from '@/lib/api'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import toast from 'react-hot-toast'

interface TestCase {
  id: string
  name: string
  description: string
  file_name: string
  file_content: string
  version: number
  updated_at: string
}

interface TestCaseEditorProps {
  testId: string
  headless?: boolean
  onRun?: (testId: string, name: string) => void
  onTestLoaded?: (tc: { file_name: string; version: number; name: string; updated_at: string }) => void
}

export function TestCaseEditor({ testId, headless, onRun, onTestLoaded }: TestCaseEditorProps) {
  const qc = useQueryClient()
  const [content, setContent] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  const { data: tc, isLoading } = useQuery<TestCase>({
    queryKey: ['test', testId],
    queryFn: () => testsApi.get(testId).then((r) => r.data),
    enabled: !!testId,
  })

  useEffect(() => {
    if (tc) {
      setContent(tc.file_content)
      setName(tc.name)
      setDescription(tc.description)
      setIsDirty(false)
      onTestLoaded?.({ file_name: tc.file_name, version: tc.version, name: tc.name, updated_at: tc.updated_at })
    }
  }, [tc])

  const save = useMutation({
    mutationFn: () =>
      testsApi.update(testId, { name, description, file_content: content }),
    onSuccess: (res) => {
      qc.setQueryData(['test', testId], res.data)
      qc.invalidateQueries({ queryKey: ['tests'] })
      setIsDirty(false)
      toast.success('Saved')
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.detail ?? err?.response?.data?.error ?? 'Save failed'
      toast.error(msg)
    },
  })

  const { data: versionsData } = useQuery({
    queryKey: ['versions', testId],
    queryFn: () => testsApi.versions(testId).then((r) => r.data),
    enabled: showHistory,
  })

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <div style={{ width: 22, height: 22, border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
      </div>
    )
  }

  if (!tc) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Toolbar */}
      {!headless && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', padding: '8px 16px', flexShrink: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <input
              value={name}
              onChange={(e) => { setName(e.target.value); setIsDirty(true) }}
              style={{ width: '100%', fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', background: 'none', border: 'none', outline: 'none' }}
              placeholder="Test name"
            />
            <p style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>{tc.file_name} · v{tc.version}</p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {isDirty && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--skipped)' }}>
                <AlertCircle size={11} />
                Unsaved
              </span>
            )}

            <button
              onClick={() => setShowHistory(!showHistory)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, height: 28, padding: '0 10px',
                fontSize: 12, borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                background: showHistory ? 'var(--accent-subtle)' : 'transparent',
                border: showHistory ? '1px solid var(--accent-border)' : '1px solid transparent',
                color: showHistory ? 'var(--accent-light)' : 'var(--text-muted)',
              }}
            >
              <History size={13} />
              History
            </button>

            <button
              onClick={() => onRun?.(testId, tc.name)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 28, padding: '0 12px', fontSize: 12, fontWeight: 500, background: 'rgba(52,211,153,0.10)', border: '1px solid rgba(52,211,153,0.25)', color: 'var(--passed)', borderRadius: 'var(--radius-sm)', cursor: 'pointer' }}
            >
              <Play size={12} /> Run
            </button>

            <button
              onClick={() => save.mutate()}
              disabled={!isDirty || save.isPending}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, height: 28, padding: '0 12px',
                fontSize: 12, fontWeight: 500, borderRadius: 'var(--radius-sm)', cursor: (!isDirty || save.isPending) ? 'not-allowed' : 'pointer',
                background: (isDirty && !save.isPending) ? 'linear-gradient(135deg, #6366f1, #7c3aed)' : 'rgba(255,255,255,0.04)',
                border: (isDirty && !save.isPending) ? '1px solid rgba(99,102,241,0.40)' : '1px solid var(--border)',
                color: (isDirty && !save.isPending) ? 'white' : 'var(--text-muted)',
                opacity: (!isDirty || save.isPending) ? 0.6 : 1,
              }}
            >
              {save.isPending ? (
                <RefreshCw size={12} style={{ animation: 'spin 0.7s linear infinite' }} />
              ) : save.isSuccess ? (
                <CheckCircle2 size={12} />
              ) : (
                <Save size={12} />
              )}
              Save
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Code editor */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          <CodeMirror
            value={content}
            height="100%"
            theme={oneDark}
            extensions={[javascript({ typescript: true })]}
            onChange={(val) => {
              setContent(val)
              setIsDirty(true)
            }}
            basicSetup={{
              lineNumbers: true,
              foldGutter: true,
              dropCursor: true,
              allowMultipleSelections: true,
              indentOnInput: true,
              bracketMatching: true,
              closeBrackets: true,
              autocompletion: true,
              highlightActiveLine: true,
              highlightSelectionMatches: true,
            }}
          />
        </div>

        {/* Version history panel */}
        {showHistory && (
          <div style={{ width: 240, flexShrink: 0, overflowY: 'auto', borderLeft: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
            <div style={{ borderBottom: '1px solid var(--border)', padding: '10px 14px' }}>
              <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>Version History</p>
            </div>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {(versionsData?.versions ?? []).map((v: any) => (
                <li key={v.id} style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)' }}>v{v.version}</span>
                    <button
                      onClick={() => {
                        setContent(v.file_content)
                        setIsDirty(true)
                        toast('Version restored — save to apply', { icon: '↩' })
                      }}
                      style={{ fontSize: 11, color: 'var(--accent-light)', background: 'none', border: 'none', cursor: 'pointer' }}
                    >
                      Restore
                    </button>
                  </div>
                  <p style={{ marginTop: 3, fontSize: 11, color: 'var(--text-muted)' }}>
                    {formatDistanceToNow(new Date(v.changed_at), { addSuffix: true })}
                  </p>
                </li>
              ))}
              {(versionsData?.versions ?? []).length === 0 && (
                <li style={{ padding: '16px 14px', textAlign: 'center', fontSize: 11, color: 'var(--text-muted)' }}>
                  No history yet
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
