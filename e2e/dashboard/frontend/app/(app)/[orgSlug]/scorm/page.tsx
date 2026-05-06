'use client'

import { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { Topbar } from '@/components/layout/Topbar'
import { SnapshotTable } from '@/components/scorm/SnapshotTable'
import { GeneratorGrid } from '@/components/scorm/GeneratorGrid'
import { Upload, Cpu, Upload as UploadIcon, RefreshCw } from 'lucide-react'
import { scormApi } from '@/lib/api'
import { useCurrentOrg } from '@/lib/auth'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import s from './Scorm.module.css'

interface PageProps { params: { orgSlug: string } }

export default function SCORMPage({ params }: PageProps) {
  const { orgSlug } = params
  const org = useCurrentOrg(orgSlug)
  const orgId = org?.id ?? ''
  const qc = useQueryClient()

  const [tab, setTab] = useState<'snapshots' | 'generators'>('snapshots')
  const [uploading, setUploading] = useState(false)

  const onDrop = useCallback(async (files: File[]) => {
    const file = files[0]
    if (!file || !orgId) return

    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      await scormApi.upload(orgId, formData)
      toast.success(`${file.name} submitted to Phoenix`)
      qc.invalidateQueries({ queryKey: ['snapshots', orgId] })
      setTab('snapshots')
    } catch {
      toast.error('Upload failed')
    } finally {
      setUploading(false)
    }
  }, [orgId, qc])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/zip': ['.zip'] },
    maxFiles: 1,
    maxSize: 100 * 1024 * 1024,
    disabled: uploading,
  })

  return (
    <>
      <Topbar title="SCORM" />

      <div className={s.page}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>

          {/* Upload drop zone */}
          <div
            {...getRootProps()}
            className={`${s.dropzone} ${isDragActive ? s.dropzoneDrag : ''} ${uploading ? s.dropzoneUploading : ''}`}
          >
            <input {...getInputProps()} />
            {uploading ? (
              <>
                <RefreshCw size={24} style={{ color: 'var(--skipped)', animation: 'spin 0.8s linear infinite' }} />
                <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--skipped)' }}>Uploading to Phoenix…</p>
              </>
            ) : (
              <>
                <UploadIcon size={24} style={{ color: isDragActive ? 'var(--accent-light)' : 'var(--text-muted)' }} />
                <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
                  {isDragActive ? 'Drop SCORM zip here' : 'Drag & drop a SCORM .zip, or click to browse'}
                </p>
                <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Max 100 MB · .zip files only</p>
              </>
            )}
          </div>

          {/* Tabs */}
          <div className={s.tabBar}>
            {[
              { id: 'snapshots' as const, label: 'Snapshots', icon: <Upload size={13} /> },
              { id: 'generators' as const, label: 'Test Generators', icon: <Cpu size={13} /> },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`${s.tab} ${tab === t.id ? s.tabActive : ''}`}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {tab === 'snapshots' && (
            <SnapshotTable orgId={orgId} orgSlug={orgSlug} />
          )}

          {tab === 'generators' && (
            <GeneratorGrid
              orgId={orgId}
              onGenerated={() => {
                setTab('snapshots')
                qc.invalidateQueries({ queryKey: ['snapshots', orgId] })
              }}
            />
          )}

          <div className={s.footer}>Handcrafted by Simran · ApyHub QA · 2026</div>
        </div>
      </div>
    </>
  )
}
