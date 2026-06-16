import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react"

import { AddProjectDialog } from "@/components/dialogs/add-project-dialog"
import { SDrawLoader } from "@/components/loaders/SDrawLoader"
import { ScoutEmptyState } from "@/components/ScoutEmptyState"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { useActiveOrg } from "@/lib/auth"
import {
  gitlabApi,
  productsApi,
  subProjectsApi,
  type Product,
  type ProductGitlabLink,
} from "@/lib/scout-api"

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const seconds = Math.max(0, Math.floor(diff / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? "" : "s"} ago`
}

function readError(err: unknown, fallback: string) {
  return (
    (err as { response?: { data?: { error?: string } } })?.response?.data
      ?.error ?? fallback
  )
}

type Banner = { kind: "success" | "error"; text: string } | null

export default function ProjectsPage() {
  const navigate = useNavigate()
  const org = useActiveOrg()
  const orgId = org?.id ?? null
  const orgName = org?.name ?? ""

  const [products, setProducts] = useState<Product[] | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [banner, setBanner] = useState<Banner>(null)
  const [pendingDelete, setPendingDelete] = useState<Product | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!banner) return
    const t = setTimeout(() => setBanner(null), 3500)
    return () => clearTimeout(t)
  }, [banner])

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    productsApi
      .list(orgId)
      .then((list) => {
        if (!cancelled) setProducts(list)
      })
      .catch((err) => {
        if (cancelled) return
        setProducts([])
        setBanner({ kind: "error", text: readError(err, "Failed to load projects") })
      })
    return () => {
      cancelled = true
    }
  }, [orgId])

  const refresh = async () => {
    if (!orgId) return
    const list = await productsApi.list(orgId)
    setProducts(list)
  }

  const handleCreate = async (input: {
    name: string
    slug: string
    description: string | null
    gitlab?: ProductGitlabLink | null
  }) => {
    if (!orgId) {
      throw new Error("No organisation selected")
    }
    try {
      const created = await productsApi.create(orgId, {
        name: input.name,
        slug: input.slug,
        description: input.description ?? undefined,
        gitlab: input.gitlab ?? null,
      })
      if (input.gitlab) {
        try {
          const subProjects = await subProjectsApi.list(orgId, created.id)
          const spId = subProjects[0]?.id
          await gitlabApi.update(orgId, input.gitlab.integration_id, {
            repo_id: input.gitlab.repo_id,
            repo_name: input.gitlab.repo_name,
            repo_url: input.gitlab.repo_url,
            branch: input.gitlab.branch,
            repo_path: input.gitlab.repo_path,
            subproject_id: spId ?? null,
          })
        } catch (e) {
          console.warn("Failed to configure GitLab integration", e)
        }
      }
      await refresh()
      setBanner({ kind: "success", text: `Created "${input.name}"` })
    } catch (err) {
      const text = readError(err, "Failed to create (slug may be taken)")
      setBanner({ kind: "error", text })
      throw err
    }
  }

  const confirmDelete = async () => {
    if (!orgId || !pendingDelete) return
    const product = pendingDelete
    setDeleting(true)
    try {
      await productsApi.remove(orgId, product.id)
      await refresh()
      setBanner({ kind: "success", text: `Deleted "${product.name}"` })
      setPendingDelete(null)
    } catch (err) {
      setBanner({ kind: "error", text: readError(err, "Failed to delete project") })
    } finally {
      setDeleting(false)
    }
  }

  const count = products?.length ?? 0
  const hasAny = count > 0

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Projects</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {products === null
              ? "Loading projects…"
              : `${count} project${count === 1 ? "" : "s"}${orgName ? ` in ${orgName}` : ""}`}
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)} disabled={!orgId}>
          <PlusIcon className="size-4" />
          New Project
        </Button>
      </div>

      {banner ? (
        <div
          className={
            "ring-1 px-3 py-2 text-sm " +
            (banner.kind === "error"
              ? "ring-destructive/40 text-destructive"
              : "ring-border/40 text-foreground")
          }
        >
          {banner.text}
        </div>
      ) : null}

      {products === null ? (
        <div className="ring-border/40 flex min-h-[30vh] items-center justify-center ring-1">
          <SDrawLoader label="Loading projects…" />
        </div>
      ) : hasAny ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => (
            <ProjectCard
              key={p.id}
              product={p}
              onOpen={() => navigate(`/projects/${p.slug}`)}
              onDelete={() => setPendingDelete(p)}
            />
          ))}
        </div>
      ) : (
        <div className="ring-border/40 flex min-h-[40vh] flex-col items-center justify-center gap-3 ring-1">
          <ScoutEmptyState
            message="No projects yet"
            sub="Create your first project to organise your test suites."
          />
          <Button
            variant="secondary"
            onClick={() => setDialogOpen(true)}
            disabled={!orgId}
          >
            <PlusIcon className="size-4" />
            New Project
          </Button>
        </div>
      )}

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setPendingDelete(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete &ldquo;{pendingDelete?.name}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. All sub-projects, folders, and tests under
              this project will be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                void confirmDelete()
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AddProjectDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreate={async (project) => {
          await handleCreate({
            name: project.name,
            slug: project.slug,
            description: project.description,
            gitlab: project.gitlab ?? null,
          })
        }}
      />
    </div>
  )
}

function ProjectCard({
  product,
  onOpen,
  onDelete,
}: {
  product: Product
  onOpen: () => void
  onDelete: () => void
}) {
  const initials = useMemo(
    () => product.name.slice(0, 2).toUpperCase(),
    [product.name],
  )
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          onOpen()
        }
      }}
      className="ring-border/40 hover:bg-muted/30 focus-visible:ring-primary group flex h-full cursor-pointer flex-col gap-3 p-4 ring-1 outline-none transition-colors"
    >
      <div className="flex items-start gap-3">
        <div className="bg-muted text-foreground flex size-10 shrink-0 items-center justify-center text-sm font-semibold">
          {product.icon ? product.icon : initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-semibold">{product.name}</div>
          {product.description ? (
            <p className="text-muted-foreground mt-0.5 line-clamp-2 text-sm">
              {product.description}
            </p>
          ) : null}
          <div className="text-muted-foreground mt-1 font-mono text-xs">
            /{product.slug}
          </div>
        </div>
      </div>
      <div className="mt-auto flex items-center justify-between pt-2">
        <span className="text-muted-foreground text-xs">
          {timeAgo(product.created_at)}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-destructive hover:bg-destructive/10 hover:text-destructive size-8"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          aria-label={`Delete ${product.name}`}
        >
          <Trash2Icon className="size-4" />
        </Button>
      </div>
    </div>
  )
}
