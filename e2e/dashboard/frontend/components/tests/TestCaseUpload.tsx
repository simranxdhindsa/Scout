'use client'

import { useCallback, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { Upload, FileCode2, X, CheckCircle2, AlertCircle } from 'lucide-react'
import { testsApi } from '@/lib/api'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'

interface TestCaseUploadProps {
  folderId: string
  onUploaded?: (testId: string) => void
  onCancel?: () => void
}

interface ValidationError {
  line?: number
  message: string
}

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

export function TestCaseUpload({ folderId, onUploaded, onCancel }: TestCaseUploadProps) {
  const qc = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([])

  const onDrop = useCallback((accepted: File[]) => {
    const f = accepted[0]
    if (!f) return
    setFile(f)
    setValidationErrors([])
    if (!name) {
      setName(f.name.replace(/\.(spec\.)?(ts|js)$/, '').replace(/[-_]/g, ' '))
    }
  }, [name])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/plain': ['.ts', '.js'] },
    maxFiles: 1,
    maxSize: 500 * 1024,
  })

  const upload = useMutation({
    mutationFn: async () => {
      if (!file || !name.trim()) throw new Error('Missing required fields')
      const text = await file.text()
      return testsApi.upload(folderId, {
        name: name.trim(),
        description,
        file_name: file.name,
        file_content: text,
      })
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['tests', folderId] })
      toast.success('Test case uploaded')
      onUploaded?.(res.data.id)
    },
    onError: (err: any) => {
      const data = err?.response?.data
      if (data?.errors) {
        setValidationErrors(data.errors)
      } else {
        toast.error(data?.error ?? 'Upload failed')
      }
    },
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>Upload Test File</h3>
        {onCancel && (
          <button onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: 4 }}>
            <X size={15} />
          </button>
        )}
      </div>

      {/* Drop zone */}
      <div
        {...getRootProps()}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          padding: '32px 20px',
          border: `2px dashed ${isDragActive ? 'var(--accent)' : file ? 'rgba(52,211,153,0.4)' : 'var(--border-strong)'}`,
          borderRadius: 'var(--radius-lg)',
          background: isDragActive ? 'var(--accent-subtle)' : file ? 'rgba(52,211,153,0.06)' : 'rgba(255,255,255,0.02)',
          cursor: 'pointer',
          textAlign: 'center',
          transition: 'all 150ms',
        }}
      >
        <input {...getInputProps()} />
        {file ? (
          <>
            <FileCode2 size={24} style={{ color: 'var(--passed)' }} />
            <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--passed)' }}>{file.name}</p>
            <p style={{ fontSize: 11, color: 'var(--passed)', opacity: 0.7 }}>{(file.size / 1024).toFixed(1)} KB</p>
            <button
              onClick={(e) => { e.stopPropagation(); setFile(null) }}
              style={{ fontSize: 12, color: 'var(--failed)', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              Remove
            </button>
          </>
        ) : (
          <>
            <Upload size={24} style={{ color: isDragActive ? 'var(--accent-light)' : 'var(--text-muted)' }} />
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              {isDragActive ? 'Drop to upload' : 'Drag .ts or .js file here, or click to browse'}
            </p>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', opacity: 0.7 }}>Max 500 KB · Playwright tests only</p>
          </>
        )}
      </div>

      {/* Validation errors */}
      {validationErrors.length > 0 && (
        <div style={{ padding: '12px 14px', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)', borderRadius: 'var(--radius-md)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 500, color: 'var(--failed)', marginBottom: 8 }}>
            <AlertCircle size={13} />
            Validation failed
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {validationErrors.map((e, i) => (
              <li key={i} style={{ fontSize: 12, color: 'var(--failed)' }}>
                {e.line ? `Line ${e.line}: ` : ''}{e.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Name */}
      <div>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 6 }}>
          Name <span style={{ color: 'var(--failed)' }}>*</span>
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Login flow test"
          style={inputStyle}
        />
      </div>

      {/* Description */}
      <div>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 6 }}>
          Description <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span>
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="What does this test verify?"
          style={{ ...inputStyle, height: 'auto', resize: 'none' }}
        />
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
        {onCancel && (
          <button
            onClick={onCancel}
            style={{ height: 32, padding: '0 14px', fontSize: 13, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', borderRadius: 'var(--radius-md)' }}
          >
            Cancel
          </button>
        )}
        <button
          onClick={() => upload.mutate()}
          disabled={!file || !name.trim() || upload.isPending}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            height: 32, padding: '0 16px', fontSize: 13, fontWeight: 500,
            color: 'white',
            background: 'linear-gradient(135deg, #6366f1, #7c3aed)',
            border: '1px solid rgba(99,102,241,0.40)',
            borderRadius: 'var(--radius-md)',
            cursor: (!file || !name.trim() || upload.isPending) ? 'not-allowed' : 'pointer',
            opacity: (!file || !name.trim() || upload.isPending) ? 0.5 : 1,
          }}
        >
          {upload.isPending ? (
            <div style={{ width: 12, height: 12, border: '2px solid white', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
          ) : (
            <CheckCircle2 size={12} />
          )}
          {upload.isPending ? 'Uploading…' : 'Upload Test'}
        </button>
      </div>
    </div>
  )
}
