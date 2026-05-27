import { useEffect, useMemo, useState } from "react"
import { Loader2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useAuthStore } from "@/lib/auth"
import {
  gitlabApi,
  productsApi,
  subProjectsApi,
  type GitlabIntegration,
  type GitlabRepo,
  type Product,
} from "@/lib/scout-api"

export function EditProjectDialog({
  open,
  onOpenChange,
  product,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  product: Product
  onSaved?: (updated: Product) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <EditForm
        open={open}
        product={product}
        onCancel={() => onOpenChange(false)}
        onSaved={(updated) => {
          onSaved?.(updated)
          onOpenChange(false)
        }}
      />
    </Dialog>
  )
}

function EditForm({
  open,
  product,
  onCancel,
  onSaved,
}: {
  open: boolean
  product: Product
  onCancel: () => void
  onSaved: (updated: Product) => void
}) {
  const orgId = useAuthStore((s) => s.orgs[0]?.id ?? null)

  const [name, setName] = useState(product.name)
  const [slug, setSlug] = useState(product.slug)
  const [description, setDescription] = useState(product.description ?? "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [integrations, setIntegrations] = useState<GitlabIntegration[] | null>(
    null,
  )
  const [integrationId, setIntegrationId] = useState<string>(
    product.gitlab?.integration_id ?? "",
  )
  const [repos, setRepos] = useState<GitlabRepo[] | null>(null)
  const [repoId, setRepoId] = useState<number | "">(
    product.gitlab?.repo_id ?? "",
  )
  const [branch, setBranch] = useState(product.gitlab?.branch ?? "")
  const [dirs, setDirs] = useState<string[] | null>(null)
  const [repoPath, setRepoPath] = useState(product.gitlab?.repo_path ?? "")

  useEffect(() => {
    if (!open) return
    setName(product.name)
    setSlug(product.slug)
    setDescription(product.description ?? "")
    setIntegrationId(product.gitlab?.integration_id ?? "")
    setRepoId(product.gitlab?.repo_id ?? "")
    setBranch(product.gitlab?.branch ?? "")
    setRepoPath(product.gitlab?.repo_path ?? "")
    setError(null)
  }, [open, product])

  useEffect(() => {
    if (!open || !orgId) return
    let cancelled = false
    gitlabApi
      .list(orgId)
      .then((list) => {
        if (cancelled) return
        setIntegrations(list)
        // Default to the user's first connection when the product isn't already linked.
        setIntegrationId((cur) => (cur === "" && list.length > 0 ? list[0].id : cur))
      })
      .catch(() => {
        if (!cancelled) setIntegrations([])
      })
    return () => {
      cancelled = true
    }
  }, [open, orgId])

  useEffect(() => {
    if (!orgId || !integrationId) {
      setRepos(null)
      return
    }
    let cancelled = false
    setRepos(null)
    gitlabApi
      .listRepos(orgId, integrationId)
      .then((list) => {
        if (!cancelled) setRepos(list)
      })
      .catch(() => {
        if (!cancelled) setRepos([])
      })
    return () => {
      cancelled = true
    }
  }, [orgId, integrationId])

  useEffect(() => {
    if (!orgId || !integrationId || repoId === "") {
      setDirs(null)
      return
    }
    const repo = repos?.find((r) => r.id === repoId)
    if (!repo) return
    let cancelled = false
    setDirs(null)
    gitlabApi
      .listDirs(orgId, integrationId, {
        repoId: repo.id,
        branch: branch || repo.default_branch,
      })
      .then((list) => {
        if (!cancelled) setDirs(list)
      })
      .catch(() => {
        if (!cancelled) setDirs([])
      })
    return () => {
      cancelled = true
    }
  }, [orgId, integrationId, repoId, branch, repos])

  const selectedRepo = useMemo(
    () => (repoId === "" ? null : (repos?.find((r) => r.id === repoId) ?? null)),
    [repos, repoId],
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!orgId) return
    const trimmedName = name.trim()
    const trimmedSlug = slug.trim()
    if (!trimmedName || !trimmedSlug) return
    setSaving(true)
    setError(null)
    try {
      const gitlab =
        integrationId && (selectedRepo || product.gitlab)
          ? {
              integration_id: integrationId,
              repo_id:
                selectedRepo?.id ?? product.gitlab?.repo_id ?? 0,
              repo_name:
                selectedRepo?.path_with_namespace ??
                product.gitlab?.repo_name ??
                "",
              repo_url:
                selectedRepo?.web_url ?? product.gitlab?.repo_url ?? "",
              branch:
                branch ||
                selectedRepo?.default_branch ||
                product.gitlab?.branch ||
                "main",
              repo_path: repoPath,
            }
          : null
      const updated = await productsApi.update(orgId, product.id, {
        name: trimmedName,
        slug: trimmedSlug,
        description: description.trim(),
        gitlab,
      })

      // The backend's SyncRepo reads repo info from the integration record,
      // not the product link — so push the same values onto the integration
      // (along with the product's active sub-project) so sync can actually run.
      if (gitlab) {
        try {
          const subProjects = await subProjectsApi.list(orgId, product.id)
          const spId = subProjects[0]?.id
          await gitlabApi.update(orgId, gitlab.integration_id, {
            repo_id: gitlab.repo_id,
            repo_name: gitlab.repo_name,
            repo_url: gitlab.repo_url,
            branch: gitlab.branch,
            repo_path: gitlab.repo_path,
            subproject_id: spId ?? null,
          })
        } catch (e) {
          // Non-fatal: the project saved fine; only sync will fail later.
          console.warn("Failed to configure GitLab integration", e)
        }
      }

      onSaved(updated)
    } catch (err) {
      setError(
        (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error ?? "Failed to save project",
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>Project settings</DialogTitle>
        <DialogDescription>
          Edit the project details and GitLab connection.
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="edit-project-name">
            Name
          </label>
          <Input
            id="edit-project-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
            className="bg-muted/40 px-3"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="edit-project-slug">
            Slug
          </label>
          <Input
            id="edit-project-slug"
            value={slug}
            onChange={(e) =>
              setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))
            }
            required
            className="bg-muted/40 px-3 font-mono"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label
            className="text-sm font-medium"
            htmlFor="edit-project-description"
          >
            Description{" "}
            <span className="text-muted-foreground font-normal">
              (optional)
            </span>
          </label>
          <textarea
            id="edit-project-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="bg-muted/40 ring-border/40 placeholder:text-muted-foreground resize-y p-3 text-sm outline-none ring-1 focus-visible:ring-primary"
          />
        </div>

        {integrationId ? (
          <>
            <>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="flex flex-col gap-2">
                    <label htmlFor="edit-project-repo" className="text-sm font-medium">
                      Repository
                    </label>
                    <Select
                      value={repoId === "" ? undefined : String(repoId)}
                      onValueChange={(v) =>
                        setRepoId(v === "" ? "" : Number(v))
                      }
                    >
                      <SelectTrigger
                        id="edit-project-repo"
                        className="bg-muted/40 w-full"
                        loading={repos === null}
                      >
                        <SelectValue
                          placeholder={
                            repos === null ? "Loading repos…" : "Select your repo"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {(repos ?? []).map((r) => (
                          <SelectItem key={r.id} value={String(r.id)}>
                            {r.path_with_namespace}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-medium">Branch</label>
                    <Input
                      value={branch}
                      onChange={(e) => setBranch(e.target.value)}
                      placeholder="main"
                      disabled={repoId === ""}
                      className="bg-muted/40 px-3"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="edit-project-subfolder"
                    className="flex items-center gap-2 text-sm font-medium"
                  >
                    Subfolder{" "}
                    <span className="text-muted-foreground font-normal">
                      (optional)
                    </span>
                  </label>
                  <Select
                    value={repoPath === "" ? "__root__" : repoPath}
                    onValueChange={(v) =>
                      setRepoPath(v === "__root__" ? "" : v)
                    }
                    disabled={repoId === ""}
                  >
                    <SelectTrigger
                      id="edit-project-subfolder"
                      className="bg-muted/40 w-full"
                      loading={repoId !== "" && dirs === null}
                    >
                      <SelectValue
                        placeholder={
                          repoId !== "" && dirs === null
                            ? "Loading folders…"
                            : "/ (entire repo)"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__root__">/ (entire repo)</SelectItem>
                      {(dirs ?? []).map((d) => (
                        <SelectItem key={d} value={d}>
                          {d}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
          </>
        ) : integrations !== null && integrations.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Connect a GitLab account in Settings → Integrations to link this
            project to a repository.
          </p>
        ) : null}

        {error ? <p className="text-destructive text-sm">{error}</p> : null}

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={saving || !name.trim() || !slug.trim()}
          >
            {saving ? <Loader2Icon className="size-4 animate-spin" /> : null}
            Save changes
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
