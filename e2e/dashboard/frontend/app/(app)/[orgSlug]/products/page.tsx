'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { productsApi } from '@/lib/api'
import { useCurrentOrg } from '@/lib/auth'
import { Topbar } from '@/components/layout/Topbar'
import { Plus, Check, X, Layers, Trash2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import toast from 'react-hot-toast'
import s from './Products.module.css'

interface PageProps { params: { orgSlug: string } }

interface Product {
  id: string
  name: string
  slug: string
  description: string
  icon: string
  created_at: string
}

export default function ProductsPage({ params }: PageProps) {
  const { orgSlug } = params
  const router = useRouter()
  const org = useCurrentOrg(orgSlug)
  const orgId = org?.id ?? ''
  const qc = useQueryClient()

  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newSlug, setNewSlug] = useState('')
  const [newDesc, setNewDesc] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['products', orgId],
    queryFn: () => productsApi.list(orgId).then((r) => r.data),
    enabled: !!orgId,
  })

  const products: Product[] = data?.products ?? []

  const createProduct = useMutation({
    mutationFn: () => productsApi.create(orgId, { name: newName, slug: newSlug, description: newDesc }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['products', orgId] })
      toast.success('Project created')
      setCreating(false)
      setNewName(''); setNewSlug(''); setNewDesc('')
      router.push(`/${orgSlug}/products/${res.data.slug}`)
    },
    onError: () => toast.error('Failed to create (slug may be taken)'),
  })

  const deleteProduct = useMutation({
    mutationFn: (id: string) => productsApi.delete(orgId, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products', orgId] })
      toast.success('Project deleted')
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
        title="Projects"
        actions={
          <button onClick={() => setCreating(true)} className={s.btnPrimary}>
            <Plus size={13} /> New Project
          </button>
        }
      />

      <div className={s.page}>
        <div className={s.pageHeader}>
          <div>
            <h1 className={s.pageTitle}>Projects</h1>
            <p className={s.pageSub}>{products.length} project{products.length !== 1 ? 's' : ''} in {org?.name ?? orgSlug}</p>
          </div>
        </div>

        {creating && (
          <div className={s.createForm}>
            <input
              autoFocus
              value={newName}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Project name"
              className={s.input}
              onKeyDown={(e) => e.key === 'Enter' && newName && newSlug && createProduct.mutate()}
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
              onClick={() => createProduct.mutate()}
              disabled={!newName.trim() || !newSlug.trim() || createProduct.isPending}
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
            <div className={s.emptyState}>
              <p className={s.emptyDesc}>Loading…</p>
            </div>
          )}

          {!isLoading && products.length === 0 && (
            <div className={s.emptyState}>
              <div className={s.emptyIcon}><Layers size={22} /></div>
              <p className={s.emptyTitle}>No projects yet</p>
              <p className={s.emptyDesc}>Create your first project to organise your test suites</p>
              <button className={s.btnPrimary} onClick={() => setCreating(true)} style={{ marginTop: 4 }}>
                <Plus size={13} /> New Project
              </button>
            </div>
          )}

          {products.map((product) => (
            <div
              key={product.id}
              className={s.card}
              onClick={() => router.push(`/${orgSlug}/products/${product.slug}`)}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                <div className={s.cardIcon}>
                  {product.icon || product.name.slice(0, 2).toUpperCase()}
                </div>
                <div className={s.cardBody}>
                  <div className={s.cardName}>{product.name}</div>
                  {product.description && (
                    <div className={s.cardDesc}>{product.description}</div>
                  )}
                  <div className={s.cardSlug}>/{product.slug}</div>
                </div>
              </div>

              <div className={s.cardFooter}>
                <span className={s.cardMeta}>
                  {formatDistanceToNow(new Date(product.created_at), { addSuffix: true })}
                </span>
                <button
                  className={s.btnDanger}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (confirm(`Delete "${product.name}"? This cannot be undone.`)) {
                      deleteProduct.mutate(product.id)
                    }
                  }}
                  title="Delete project"
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
