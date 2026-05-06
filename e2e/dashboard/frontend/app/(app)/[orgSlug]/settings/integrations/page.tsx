'use client'

import { useEffect, useRef, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { integrationsApi, productsApi, subProjectsApi } from '@/lib/api'
import { useCurrentOrg } from '@/lib/auth'
import { Topbar } from '@/components/layout/Topbar'
import { RefreshCw, Trash2, ExternalLink, GitBranch, Link2, ChevronDown, Check } from 'lucide-react'
import toast from 'react-hot-toast'
import s from '../Settings.module.css'

interface PageProps { params: { orgSlug: string } }

interface GitLabIntegration {
  id: string
  org_id: string
  subproject_id: string | null
  gitlab_username: string
  gitlab_avatar: string
  repo_id: number
  repo_name: string
  repo_url: string
  branch: string
  repo_path: string
  last_synced_at: string | null
  created_at: string
}

interface GitLabRepo {
  id: number
  name: string
  path_with_namespace: string
  web_url: string
  default_branch: string
}

const inputStyle: React.CSSProperties = {
  height: 34,
  padding: '0 10px',
  background: 'rgba(7,7,15,0.8)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  fontSize: 13,
  color: 'var(--text-primary)',
  fontFamily: 'Inter, sans-serif',
  outline: 'none',
  width: '100%',
}

// ── Minimal custom dropdown ───────────────────────────────────────────────────

interface DropdownOption { value: string; label: string }

function Dropdown({ options, value, onChange, placeholder, disabled }: {
  options: DropdownOption[]
  value: string
  onChange: (v: string) => void
  placeholder?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selected = options.find((o) => o.value === value)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        style={{
          ...inputStyle,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
          textAlign: 'left',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: selected ? 'var(--text-primary)' : 'var(--text-muted)' }}>
          {selected ? selected.label : (placeholder ?? '— select —')}
        </span>
        <ChevronDown size={13} style={{ flexShrink: 0, color: 'var(--text-muted)', transition: 'transform 150ms', transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 4px)',
          left: 0,
          right: 0,
          zIndex: 50,
          background: '#12121f',
          border: '1px solid var(--border-strong)',
          borderRadius: 'var(--radius-md)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          maxHeight: 220,
          overflowY: 'auto',
        }}>
          {options.length === 0 && (
            <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-muted)' }}>No options</div>
          )}
          {options.map((opt) => (
            <div
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false) }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                fontSize: 13,
                color: opt.value === value ? 'var(--accent-light)' : 'var(--text-primary)',
                background: opt.value === value ? 'var(--accent-subtle)' : 'transparent',
                cursor: 'pointer',
                transition: 'background 100ms',
              }}
              onMouseEnter={(e) => { if (opt.value !== value) (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.04)' }}
              onMouseLeave={(e) => { if (opt.value !== value) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{opt.label}</span>
              {opt.value === value && <Check size={12} style={{ flexShrink: 0, color: 'var(--accent-light)' }} />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function IntegrationsPage({ params }: PageProps) {
  const { orgSlug } = params
  const org = useCurrentOrg(orgSlug)
  const orgId = org?.id ?? ''
  const qc = useQueryClient()
  const searchParams = useSearchParams()
  const router = useRouter()

  useEffect(() => {
    if (searchParams.get('gitlab_connected') === 'true') {
      toast.success('GitLab connected successfully')
      router.replace(`/${orgSlug}/settings/integrations`)
    }
  }, [searchParams, orgSlug, router])

  const { data, isLoading } = useQuery({
    queryKey: ['gitlab-integrations', orgId],
    queryFn: () => integrationsApi.listGitLab(orgId).then((r) => r.data),
    enabled: !!orgId,
  })

  const integrations: GitLabIntegration[] = data?.integrations ?? []

  function handleConnect() {
    const returnTo = `/${orgSlug}/settings/integrations`
    window.location.href = integrationsApi.connectUrl(orgId, returnTo)
  }

  return (
    <>
      <Topbar title="Settings" />
      <div className={s.page}>
        <h1 className={s.pageTitle}>Integrations</h1>

        <div className={s.card}>
          <div className={s.sectionHeader}>
            <div>
              <span className={s.sectionTitle}>GitLab</span>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                Connect a GitLab repository to import Playwright spec files into Scout.
              </p>
            </div>
            {integrations.length === 0 && !isLoading && (
              <button onClick={handleConnect} className={s.btnPrimary}>
                <Link2 size={13} /> Connect GitLab
              </button>
            )}
          </div>

          {isLoading && (
            <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>Loading…</div>
          )}

          {!isLoading && integrations.length === 0 && (
            <div style={{ padding: '24px 0', textAlign: 'center' }}>
              <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--accent-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
                <GitBranch size={22} style={{ color: 'var(--accent-light)' }} />
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No GitLab repositories connected yet.</p>
            </div>
          )}

          {integrations.map((integ) => (
            <IntegrationCard
              key={integ.id}
              integ={integ}
              orgId={orgId}
              orgSlug={orgSlug}
              onDisconnect={() => qc.invalidateQueries({ queryKey: ['gitlab-integrations', orgId] })}
              onSynced={() => qc.invalidateQueries({ queryKey: ['gitlab-integrations', orgId] })}
              onUpdated={() => qc.invalidateQueries({ queryKey: ['gitlab-integrations', orgId] })}
            />
          ))}

          {integrations.length > 0 && (
            <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <button onClick={handleConnect} className={s.btnSecondary}>
                <Link2 size={13} /> Connect another repo
              </button>
            </div>
          )}
        </div>

        <div className={s.footer}>Handcrafted by Simran · ApyHub QA · 2026</div>
      </div>
    </>
  )
}

function IntegrationCard({
  integ, orgId, orgSlug,
  onDisconnect, onSynced, onUpdated,
}: {
  integ: GitLabIntegration
  orgId: string
  orgSlug: string
  onDisconnect: () => void
  onSynced: () => void
  onUpdated: () => void
}) {
  const [branch, setBranch] = useState(integ.branch || 'main')
  const [subprojectId, setSubprojectId] = useState(integ.subproject_id ?? '')
  const [selectedRepoId, setSelectedRepoId] = useState<number>(integ.repo_id)
  const [selectedRepoName, setSelectedRepoName] = useState(integ.repo_name)
  const [selectedRepoUrl, setSelectedRepoUrl] = useState(integ.repo_url)
  const [repoPath, setRepoPath] = useState(integ.repo_path || '')
  const [dirty, setDirty] = useState(false)

  const { data: repoData, isLoading: reposLoading } = useQuery({
    queryKey: ['gitlab-repos', integ.id],
    queryFn: () => integrationsApi.listRepos(orgId, integ.id).then((r) => r.data),
    staleTime: 60_000,
  })
  const repos: GitLabRepo[] = repoData?.repos ?? []

  const { data: dirsData, isLoading: dirsLoading } = useQuery({
    queryKey: ['gitlab-dirs', integ.id, selectedRepoId],
    queryFn: () => integrationsApi.listDirs(orgId, integ.id).then((r) => r.data),
    enabled: selectedRepoId > 0,
    staleTime: 60_000,
  })
  const dirs: string[] = dirsData?.dirs ?? []

  const { data: productsData } = useQuery({
    queryKey: ['products', orgId],
    queryFn: () => productsApi.list(orgId).then((r) => r.data),
    staleTime: 30_000,
    enabled: !!orgId,
  })
  const products: any[] = productsData?.products ?? []

  const sync = useMutation({
    mutationFn: () => integrationsApi.sync(orgId, integ.id),
    onSuccess: (res) => {
      const { added, updated, skipped } = res.data
      toast.success(`Sync complete: ${added} added, ${updated} updated, ${skipped} skipped`)
      onSynced()
    },
    onError: (err: any) => toast.error(err?.response?.data?.error ?? 'Sync failed'),
  })

  const update = useMutation({
    mutationFn: () => integrationsApi.update(orgId, integ.id, {
      subproject_id: subprojectId || null,
      repo_id: selectedRepoId,
      repo_name: selectedRepoName,
      repo_url: selectedRepoUrl,
      branch,
      repo_path: repoPath,
    }),
    onSuccess: () => {
      toast.success('Settings saved')
      setDirty(false)
      onUpdated()
    },
    onError: (err: any) => toast.error(err?.response?.data?.error ?? 'Failed to save'),
  })

  const disconnect = useMutation({
    mutationFn: () => integrationsApi.disconnect(orgId, integ.id),
    onSuccess: () => {
      toast.success('GitLab disconnected')
      onDisconnect()
    },
    onError: () => toast.error('Failed to disconnect'),
  })

  function handleRepoChange(repoIdStr: string) {
    const repo = repos.find((r) => String(r.id) === repoIdStr)
    if (repo) {
      setSelectedRepoId(repo.id)
      setSelectedRepoName(repo.name)
      setSelectedRepoUrl(repo.web_url)
      setBranch(repo.default_branch || 'main')
      setRepoPath('') // reset subfolder when repo changes
    }
    setDirty(true)
  }

  const repoOptions: DropdownOption[] = repos.map((r) => ({
    value: String(r.id),
    label: r.path_with_namespace,
  }))

  const isReady = selectedRepoId > 0 && subprojectId && branch

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 16, marginTop: 8 }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        {integ.gitlab_avatar ? (
          <img src={integ.gitlab_avatar} alt={integ.gitlab_username} style={{ width: 32, height: 32, borderRadius: '50%' }} />
        ) : (
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--accent-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, color: 'var(--accent-light)' }}>
            {integ.gitlab_username?.[0]?.toUpperCase() ?? 'G'}
          </div>
        )}
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            {integ.gitlab_username}
            <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>via GitLab OAuth</span>
          </p>
          {integ.repo_url && (
            <a href={integ.repo_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: 'var(--accent-light)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              {integ.repo_name} <ExternalLink size={10} />
            </a>
          )}
        </div>
        {integ.last_synced_at && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Last synced {new Date(integ.last_synced_at).toLocaleString()}
          </span>
        )}
      </div>

      {/* Settings fields */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
        <div>
          <label className={s.label}>Repository</label>
          <Dropdown
            options={repoOptions}
            value={String(selectedRepoId === 0 ? '' : selectedRepoId)}
            onChange={handleRepoChange}
            placeholder={reposLoading ? 'Loading…' : '— select a repo —'}
            disabled={reposLoading}
          />
        </div>

        <div>
          <label className={s.label}>Branch</label>
          <input
            style={inputStyle}
            value={branch}
            onChange={(e) => { setBranch(e.target.value); setDirty(true) }}
            placeholder="main"
          />
        </div>

        <div style={{ gridColumn: '1 / -1' }}>
          <label className={s.label}>Subfolder <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional — leave blank to scan entire repo)</span></label>
          <Dropdown
            options={[{ value: '', label: '/ (entire repo)' }, ...dirs.map((d) => ({ value: d, label: `/${d}` }))]}
            value={repoPath}
            onChange={(v) => { setRepoPath(v); setDirty(true) }}
            placeholder={selectedRepoId === 0 ? 'Select a repo first' : dirsLoading ? 'Loading folders…' : '/ (entire repo)'}
            disabled={selectedRepoId === 0 || dirsLoading}
          />
        </div>

        <div style={{ gridColumn: '1 / -1' }}>
          <label className={s.label}>Target Subproject (where tests will be imported)</label>
          <SubprojectPicker
            orgId={orgId}
            products={products}
            value={subprojectId}
            onChange={(v) => { setSubprojectId(v); setDirty(true) }}
          />
        </div>
      </div>

      {/* Action row */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {dirty && (
          <button className={s.btnPrimary} onClick={() => update.mutate()} disabled={update.isPending}>
            {update.isPending ? 'Saving…' : 'Save'}
          </button>
        )}
        <button
          className={s.btnSecondary}
          onClick={() => sync.mutate()}
          disabled={sync.isPending || !isReady}
          title={!isReady ? 'Select a repo and subproject first' : 'Pull latest spec files'}
        >
          <RefreshCw size={13} style={{ animation: sync.isPending ? 'spin 1s linear infinite' : 'none' }} />
          {sync.isPending ? 'Syncing…' : 'Sync Now'}
        </button>
        <button
          className={s.btnDestructive}
          style={{ marginLeft: 'auto' }}
          onClick={() => confirm(`Disconnect GitLab repo "${integ.repo_name || integ.gitlab_username}"?`) && disconnect.mutate()}
          disabled={disconnect.isPending}
        >
          <Trash2 size={12} /> Disconnect
        </button>
      </div>
    </div>
  )
}

function SubprojectPicker({ orgId, products, value, onChange }: {
  orgId: string
  products: any[]
  value: string
  onChange: (id: string) => void
}) {
  const [allSubprojects, setAllSubprojects] = useState<{ id: string; name: string; productName: string }[]>([])

  useEffect(() => {
    if (!orgId || products.length === 0) return
    Promise.all(
      products.map((p) =>
        subProjectsApi.list(orgId, p.id).then((r) =>
          (r.data.sub_projects ?? []).map((sp: any) => ({
            id: sp.id,
            name: sp.name,
            productName: p.name,
          }))
        )
      )
    ).then((nested) => setAllSubprojects(nested.flat()))
  }, [orgId, products])

  const options: DropdownOption[] = allSubprojects.map((sp) => ({
    value: sp.id,
    label: `${sp.productName} / ${sp.name}`,
  }))

  return (
    <Dropdown
      options={options}
      value={value}
      onChange={onChange}
      placeholder="— select a subproject —"
    />
  )
}