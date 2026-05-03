'use client'

import { useState } from 'react'
import { Topbar } from '@/components/layout/Topbar'
import { FolderTree } from '@/components/tests/FolderTree'
import { TestCaseEditor } from '@/components/tests/TestCaseEditor'
import { TestCaseUpload } from '@/components/tests/TestCaseUpload'
import { RunModal } from '@/components/runs/RunModal'
import { Upload, Plus } from 'lucide-react'
import { useCurrentOrg } from '@/lib/auth'
import { useQuery } from '@tanstack/react-query'
import { subProjectsApi, productsApi } from '@/lib/api'
import s from './TestTree.module.css'

interface PageProps {
  params: { orgSlug: string; productSlug: string; spSlug: string }
}

export default function SubProjectPage({ params }: PageProps) {
  const { orgSlug, productSlug, spSlug } = params
  const org = useCurrentOrg(orgSlug)
  const orgId = org?.id ?? ''

  const [selectedTestId, setSelectedTestId] = useState<string | null>(null)
  const [showUpload, setShowUpload] = useState(false)
  const [runTarget, setRunTarget] = useState<{
    type: 'test_case' | 'folder'
    ids: string[]
    label: string
  } | null>(null)

  const { data: productsData } = useQuery({
    queryKey: ['products', orgId],
    queryFn: () => productsApi.list(orgId).then((r) => r.data),
    enabled: !!orgId,
  })

  const product = productsData?.products?.find((p: any) => p.slug === productSlug)

  const { data: spData } = useQuery({
    queryKey: ['subprojects', orgId, product?.id],
    queryFn: () => subProjectsApi.list(orgId, product!.id).then((r) => r.data),
    enabled: !!product?.id,
  })

  const sp = spData?.sub_projects?.find((sp: any) => sp.slug === spSlug)
  const spId = sp?.id ?? ''

  return (
    <>
      <Topbar
        title={sp?.name ?? spSlug}
        actions={
          <button
            onClick={() => { setShowUpload(true); setSelectedTestId(null) }}
            className={s.btnSecondary}
          >
            <Upload size={13} /> Upload Test
          </button>
        }
      />

      <div className={s.shell}>
        {/* Tree panel */}
        <div className={s.treePanel}>
          {spId && (
            <FolderTree
              spId={spId}
              orgId={orgId}
              orgSlug={orgSlug}
              selectedTestId={selectedTestId ?? undefined}
              onSelectTest={(id) => { setSelectedTestId(id); setShowUpload(false) }}
              onRunTest={(id, name) =>
                setRunTarget({ type: 'test_case', ids: [id], label: name })
              }
              onRunFolder={(id, name) =>
                setRunTarget({ type: 'folder', ids: [id], label: name })
              }
            />
          )}
        </div>

        {/* Code/content panel */}
        <div className={s.codePanel}>
          {showUpload && spId && (
            <div className={s.uploadWrap}>
              <TestCaseUpload
                folderId={spId}
                onUploaded={(id) => { setSelectedTestId(id); setShowUpload(false) }}
                onCancel={() => setShowUpload(false)}
              />
            </div>
          )}

          {selectedTestId && !showUpload && (
            <TestCaseEditor
              testId={selectedTestId}
              onRun={(id, name) =>
                setRunTarget({ type: 'test_case', ids: [id], label: name })
              }
            />
          )}

          {!selectedTestId && !showUpload && (
            <div className={s.emptyState}>
              <div className={s.emptyCard}>
                <Plus size={24} style={{ margin: '0 auto 12px', opacity: 0.4, color: 'var(--text-muted)', display: 'block' }} />
                <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 4 }}>Select a test to edit</p>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>Pick a test from the tree, or upload a new one</p>
                <button onClick={() => setShowUpload(true)} className={s.btnPrimary} style={{ margin: '0 auto' }}>
                  <Upload size={12} /> Upload Test File
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {runTarget && orgId && (
        <RunModal
          orgId={orgId}
          orgSlug={orgSlug}
          targetType={runTarget.type}
          targetIds={runTarget.ids}
          targetLabel={runTarget.label}
          onClose={() => setRunTarget(null)}
          onStarted={(runId) => {
            window.location.href = `/${orgSlug}/runs/${runId}`
          }}
        />
      )}
    </>
  )
}
