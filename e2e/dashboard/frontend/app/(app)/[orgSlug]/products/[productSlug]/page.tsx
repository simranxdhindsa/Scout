'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { productsApi, subProjectsApi } from '@/lib/api'
import { useCurrentOrg } from '@/lib/auth'
import { Topbar } from '@/components/layout/Topbar'
import { Plus, Check, X, FolderOpen, Trash2, ArrowLeft, FileCode2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import Link from 'next/link'
import toast from 'react-hot-toast'
import s from '../Products.module.css'

interface PageProps { params: { orgSlug: string; productSlug: string } }

interface SubProject {
  id: string
  name: string
  slug: string
  description: string
  created_at: string
}

export default function ProductPage({ params }: PageProps) {
  const { orgSlug, productSlug } = params
  const router = useRouter()
  const org = useCurrentOrg(orgSlug)
  const orgId = org?.id ?? ''
  const qc = useQueryClient()

  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newSlug, setNewSlug] = useState('')
  const [newDesc, setNewDesc] = useState('')

  const { data: productsData } = useQuery({
    queryKey: ['products', orgId],
    queryFn: () => productsApi.list(orgId).then((r) => r.data),
    enabled: !!orgId,
  })

  const product = productsData?.products?.find((p: any) => p.slug === productSlug)
  const productId = product?.id ?? ''

  const { data: spData, isLoading } = useQuery({
    queryKey: ['subprojects', orgId, productId],
    queryFn: () => subProjectsApi.list(orgId, productId).then((r) => r.data),
    enabled: !!productId,
  })

  const subProjects: SubProject[] = spData?.sub_projects ?? []

  const createSP = useMutation({
    mutationFn: () => subProjectsApi.create(orgId, productId, { name: newName, slug: newSlug, description: newDesc }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['subprojects', orgId, productId] })
      toast.success('Sub-project created')
      setCreating(false)
      setNewName(''); setNewSlug(''); setNewDesc('')
      router.push(`/${orgSlug}/products/${productSlug}/${res.data.slug}`)
    },
    onError: () => toast.error('Failed to create (slug may be taken)'),
  })

  const deleteSP = useMutation({
    mutationFn: (id: string) => subProjectsApi.delete(orgId, productId, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['subprojects', orgId, productId] })
      toast.success('Sub-project deleted')
    },
    onError: () => toast.error('Delete failed'),
  })

  function handleNameChange(val: string) {
    setNewName(val)
    if (!newSlug || newSlug === slugify(newName)) {
      setNewSlug(slugify(val))
    }
  }

  return (
    <>
      <Topbar
        title={product?.name ?? productSlug}
        actions={
          <button onClick={() => setCreating(true)} className={s.btnPrimary}>
            <Plus size={13} /> New Suite
          </button>
        }
      />

      <div className={s.page}>
        <div className={s.pageHeader}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Link
                href={`/${orgSlug}/products`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-muted)', textDecoration: 'none' }}
              >
                <ArrowLeft size={12} /> Projects
              </Link>
              <span style={{ fontSize: 12, color: 'var(--border-strong)' }}>/</span>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{product?.name ?? productSlug}</span>
            </div>
            <h1 className={s.pageTitle}>{product?.name ?? productSlug}</h1>
            {product?.description && <p className={s.pageSub}>{product.description}</p>}
          </div>
        </div>

        {creating && (
          <div className={s.createForm}>
            <input
              autoFocus
              value={newName}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Suite name"
              className={s.input}
              onKeyDown={(e) => e.key === 'Enter' && newName && newSlug && createSP.mutate()}
            />
            <input
              value={newSlug}
              onChange={(e) => setNewSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
              placeholder="slug"
              className={s.inputSlug}
            />
            <input
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Description (optional)"
              className={s.inputDesc}
            />
            <button
              onClick={() => createSP.mutate()}
              disabled={!newName.trim() || !newSlug.trim() || createSP.isPending}
              className={s.btnApprove}
            >
              <Check size={13} />
            </button>
            <button onClick={() => { setCreating(false); setNewName(''); setNewSlug(''); setNewDesc('') }} className={s.btnDanger}>
              <X size={13} />
            </button>
          </div>
        )}

        <div className={s.grid}>
          {isLoading && (
            <div className={s.emptyState}><p className={s.emptyDesc}>Loading…</p></div>
          )}

          {!isLoading && subProjects.length === 0 && (
            <div className={s.emptyState}>
              <div className={s.emptyIcon}><FileCode2 size={22} /></div>
              <p className={s.emptyTitle}>No test suites yet</p>
              <p className={s.emptyDesc}>Add a suite to start organising your test cases</p>
              <button className={s.btnPrimary} onClick={() => setCreating(true)} style={{ marginTop: 4 }}>
                <Plus size={13} /> New Suite
              </button>
            </div>
          )}

          {subProjects.map((sp) => (
            <div
              key={sp.id}
              className={s.card}
              onClick={() => router.push(`/${orgSlug}/products/${productSlug}/${sp.slug}`)}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div className={s.cardIcon} style={{ fontSize: 20 }}>
                  <FolderOpen size={20} />
                </div>
                <div className={s.cardBody}>
                  <div className={s.cardName}>{sp.name}</div>
                  {sp.description && <div className={s.cardDesc}>{sp.description}</div>}
                  <div className={s.cardSlug}>/{sp.slug}</div>
                </div>
              </div>

              <div className={s.cardFooter}>
                <span className={s.cardMeta}>
                  {formatDistanceToNow(new Date(sp.created_at), { addSuffix: true })}
                </span>
                <button
                  className={s.btnDanger}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (confirm(`Delete "${sp.name}"? All tests inside will be lost.`)) {
                      deleteSP.mutate(sp.id)
                    }
                  }}
                  title="Delete suite"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className={s.footer}>Handcrafted by Simran · ApyHub QA · 2026</div>
      </div>
    </>
  )
}

function slugify(str: string) {
  return str.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
