'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { subProjectsApi, productsApi, runsApi, testsApi } from '@/lib/api'
import { useCurrentOrg } from '@/lib/auth'
import { FolderTree } from '@/components/tests/FolderTree'
import { TestCaseEditor } from '@/components/tests/TestCaseEditor'
import { TestCaseUpload } from '@/components/tests/TestCaseUpload'
import { RunModal } from '@/components/runs/RunModal'
import {
  Upload, Plus, FolderPlus, Play, Clock, FileCode2,
  Search, MoreHorizontal, Copy, Download, Pencil,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import Link from 'next/link'
import toast from 'react-hot-toast'
import s from './TestTree.module.css'

interface PageProps {
  params: { orgSlug: string; productSlug: string; spSlug: string }
}

type Tab = 'code' | 'history' | 'versions'

export default function SubProjectPage({ params }: PageProps) {
  const { orgSlug, productSlug, spSlug } = params
  const org = useCurrentOrg(orgSlug)
  const orgId = org?.id ?? ''

  const [selectedTestId, setSelectedTestId] = useState<string | null>(null)
  const [showUpload, setShowUpload] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('code')
  const [treeSearch, setTreeSearch] = useState('')
  const [tcMeta, setTcMeta] = useState<{ file_name: string; version: number; name: string; updated_at: string } | null>(null)
  const [runTarget, setRunTarget] = useState<{
    type: 'test_case' | 'folder'; ids: string[]; label: string
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

  // Root folder for this sub-project (needed for uploads)
  const { data: rootFolderData } = useQuery({
    queryKey: ['root-folder', spId],
    queryFn: () => subProjectsApi.rootFolder(spId).then((r) => r.data),
    enabled: !!spId,
  })
  const uploadFolderId: string = rootFolderData?.folder_id ?? ''

  // Run history for selected test
  const { data: runsData } = useQuery({
    queryKey: ['test-runs', orgId, selectedTestId],
    queryFn: () => runsApi.list(orgId, { limit: 10 }).then((r) => r.data),
    enabled: !!selectedTestId && activeTab === 'history',
  })

  // Versions for selected test
  const { data: versionsData } = useQuery({
    queryKey: ['versions', selectedTestId],
    queryFn: () => testsApi.versions(selectedTestId!).then((r) => r.data),
    enabled: !!selectedTestId && activeTab === 'versions',
  })

  function selectTest(id: string) {
    setSelectedTestId(id)
    setShowUpload(false)
    setActiveTab('code')
    setTcMeta(null)
  }

  return (
    <>
      {/* Topbar with breadcrumb */}
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        height: 48, padding: '0 20px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-surface)', flexShrink: 0, position: 'sticky', top: 0, zIndex: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-muted)' }}>
          <Link href={`/${orgSlug}/products`} style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
            {product?.name ?? productSlug}
          </Link>
          <span style={{ color: 'var(--border-strong)' }}>/</span>
          <Link href={`/${orgSlug}/products/${productSlug}`} style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
            {sp?.name ?? spSlug}
          </Link>
          {tcMeta && (
            <>
              <span style={{ color: 'var(--border-strong)' }}>/</span>
              <span style={{ color: 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>
                {tcMeta.file_name}
              </span>
            </>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            className={s.btnSecondary}
            onClick={() => { setShowUpload(true); setSelectedTestId(null) }}
          >
            <Upload size={13} /> Upload Test
          </button>
        </div>
      </header>

      <div className={s.body}>
        {/* ── Tree panel ── */}
        <div className={s.treePanel}>
          <div className={s.treePanelHeader}>
            <span className={s.treePanelTitle}>{sp?.name ?? spSlug}</span>
            <div className={s.treePanelActions}>
              <button className={s.btnIcon} title="New folder">
                <FolderPlus size={14} />
              </button>
              <button
                className={s.btnIcon}
                title="Upload test"
                onClick={() => { setShowUpload(true); setSelectedTestId(null) }}
              >
                <Upload size={14} />
              </button>
            </div>
          </div>

          <div className={s.treeSearch}>
            <Search size={13} />
            <input
              className={s.treeSearchInput}
              placeholder="Search tests..."
              value={treeSearch}
              onChange={(e) => setTreeSearch(e.target.value)}
            />
          </div>

          <div className={s.treeScroll}>
            {spId && (
              <FolderTree
                spId={spId}
                orgId={orgId}
                orgSlug={orgSlug}
                selectedTestId={selectedTestId ?? undefined}
                onSelectTest={selectTest}
                onRunTest={(id, name) => setRunTarget({ type: 'test_case', ids: [id], label: name })}
                onRunFolder={(id, name) => setRunTarget({ type: 'folder', ids: [id], label: name })}
              />
            )}
          </div>

          <div className={s.treeBottom}>
            <button className={s.treeBottomBtn}>
              <FolderPlus size={13} /> New Folder
            </button>
            <button
              className={s.treeBottomBtn}
              onClick={() => { setShowUpload(true); setSelectedTestId(null) }}
            >
              <Upload size={13} /> Upload Test
            </button>
          </div>
        </div>

        {/* ── Detail panel ── */}
        <div className={s.detailPanel}>
          {showUpload && uploadFolderId && (
            <div className={s.uploadWrap}>
              <div className={s.uploadInner}>
                <TestCaseUpload
                  folderId={uploadFolderId}
                  onUploaded={(id) => { selectTest(id); setShowUpload(false) }}
                  onCancel={() => setShowUpload(false)}
                />
              </div>
            </div>
          )}

          {selectedTestId && !showUpload && (
            <>
              {/* Detail header */}
              <div className={s.detailHeader}>
                <div className={s.detailHeaderLeft}>
                  <div className={s.detailFilename}>
                    <FileCode2 size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                    {tcMeta?.file_name ?? '—'}
                  </div>
                  <div className={s.detailPath}>{sp?.name ?? spSlug}</div>
                </div>
                <div className={s.detailActions}>
                  <button
                    className={s.btnGhost}
                    onClick={() => setActiveTab('history')}
                  >
                    <Clock size={13} /> History
                  </button>
                  <button
                    className={s.btnSecondary}
                    onClick={() => setActiveTab('versions')}
                  >
                    <Pencil size={13} /> Versions
                  </button>
                  <button
                    className={s.btnPrimary}
                    onClick={() => setRunTarget({ type: 'test_case', ids: [selectedTestId], label: tcMeta?.name ?? 'Test' })}
                  >
                    <Play size={13} /> Run
                  </button>
                  <button className={s.btnIcon}><MoreHorizontal size={14} /></button>
                </div>
              </div>

              {/* Meta row */}
              {tcMeta && (
                <div className={s.metaRow}>
                  <div className={s.metaPill}>
                    <span className={s.metaLabel}>Version</span>
                    <span className={s.metaDot}>·</span>
                    <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>v{tcMeta.version}</span>
                  </div>
                  <div className={s.metaPill}>
                    <span className={s.metaLabel}>Updated</span>
                    <span className={s.metaDot}>·</span>
                    <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>
                      {formatDistanceToNow(new Date(tcMeta.updated_at), { addSuffix: true })}
                    </span>
                  </div>
                  <div className={s.metaPill}>
                    <span className={s.metaLabel}>File</span>
                    <span className={s.metaDot}>·</span>
                    <span style={{ fontSize: 12, color: 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace' }}>
                      {tcMeta.file_name}
                    </span>
                  </div>
                </div>
              )}

              {/* Tabs */}
              <div className={s.tabs}>
                {(['code', 'history', 'versions'] as Tab[]).map((t) => (
                  <button
                    key={t}
                    className={`${s.tab} ${activeTab === t ? s.tabActive : ''}`}
                    onClick={() => setActiveTab(t)}
                  >
                    {t === 'code' ? 'Code' : t === 'history' ? 'Run History' : 'Versions'}
                  </button>
                ))}
              </div>

              {/* Tab body */}
              <div className={s.tabBody}>
                {activeTab === 'code' && (
                  <TestCaseEditor
                    testId={selectedTestId}
                    headless
                    onTestLoaded={setTcMeta}
                    onRun={(id, name) => setRunTarget({ type: 'test_case', ids: [id], label: name })}
                  />
                )}

                {activeTab === 'history' && (
                  <div className={s.tabContent}>
                    {(runsData?.runs ?? []).length === 0 && (
                      <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: '32px 0' }}>No runs yet</p>
                    )}
                    {(runsData?.runs ?? []).map((run: any) => (
                      <Link
                        key={run.id}
                        href={`/${orgSlug}/runs/${run.id}`}
                        className={s.historyCard}
                        style={{ textDecoration: 'none' }}
                      >
                        <span className={`${s.badge} ${run.status === 'done' ? s.badgePassed : run.status === 'failed' ? s.badgeFailed : s.badgeNeutral}`}>
                          {run.status}
                        </span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
                            {run.label || 'Run'}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            {formatDistanceToNow(new Date(run.created_at), { addSuffix: true })}
                          </div>
                        </div>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>View report →</span>
                      </Link>
                    ))}
                  </div>
                )}

                {activeTab === 'versions' && (
                  <div className={s.tabContent}>
                    {(versionsData?.versions ?? []).length === 0 && (
                      <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: '32px 0' }}>No versions yet</p>
                    )}
                    {(versionsData?.versions ?? []).map((v: any, i: number) => (
                      <div key={v.id} className={s.versionCard}>
                        <span className={`${s.badge} ${i === 0 ? s.badgeAccent : s.badgeNeutral}`}>
                          v{v.version}
                        </span>
                        <div style={{ flex: 1, fontSize: 13, color: i === 0 ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                          {i === 0 ? 'Current version · ' : ''}
                          {formatDistanceToNow(new Date(v.changed_at), { addSuffix: true })}
                        </div>
                        <button
                          className={s.btnGhost}
                          style={{ fontSize: 12 }}
                          onClick={() => toast('Restore not yet implemented')}
                        >
                          {i === 0 ? 'View' : 'Restore'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Status bar */}
              <div className={s.statusBar}>
                <span>
                  TypeScript · Playwright ·{' '}
                  <span style={{ color: 'var(--passed)' }}>✓ Valid</span>
                </span>
                <div className={s.statusActions}>
                  <button className={s.btnIcon} title="Copy"><Copy size={13} /></button>
                  <button className={s.btnIcon} title="Download"><Download size={13} /></button>
                </div>
              </div>
            </>
          )}

          {!selectedTestId && !showUpload && (
            <div className={s.emptyState}>
              <div className={s.emptyCard}>
                <Plus size={24} style={{ opacity: 0.4, color: 'var(--text-muted)' }} />
                <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>Select a test to edit</p>
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Pick a test from the tree, or upload a new one</p>
                <button
                  className={s.btnPrimary}
                  onClick={() => { setShowUpload(true) }}
                  style={{ marginTop: 8 }}
                >
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
          onStarted={(runId) => { window.location.href = `/${orgSlug}/runs/${runId}` }}
        />
      )}
    </>
  )
}
