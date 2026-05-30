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
import { useActiveOrg } from "@/lib/auth"
import {
  gitlabApi,
  slugify,
  type GitlabIntegration,
  type GitlabRepo,
} from "@/lib/scout-api"

export type NewProject = {
  name: string
  slug: string
  description: string | null
  gitlab?: {
    integration_id: string
    repo_id: number
    repo_name: string
    repo_url: string
    branch: string
    repo_path: string
  } | null
}

export function AddProjectDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate?: (project: NewProject) => Promise<void> | void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ProjectForm
        open={open}
        onCancel={() => onOpenChange(false)}
        onCreate={async (project) => {
          await onCreate?.(project)
          onOpenChange(false)
        }}
      />
    </Dialog>
  )
}

function ProjectForm({
  open,
  onCancel,
  onCreate,
}: {
  open: boolean
  onCancel: () => void
  onCreate: (project: NewProject) => Promise<void> | void
}) {
  const orgId = useActiveOrg()?.id ?? null

  const [name, setName] = useState("")
  const [slug, setSlug] = useState("")
  const [slugTouched, setSlugTouched] = useState(false)
  const [description, setDescription] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [integrations, setIntegrations] = useState<GitlabIntegration[] | null>(
    null,
  )
  const [integrationId, setIntegrationId] = useState<string>("")
  const [repos, setRepos] = useState<GitlabRepo[] | null>(null)
  const [repoError, setRepoError] = useState<string | null>(null)
  const [repoId, setRepoId] = useState<number | "">("")
  const [branch, setBranch] = useState("")
  const [dirs, setDirs] = useState<string[] | null>(null)
  const [dirError, setDirError] = useState<string | null>(null)
  const [repoPath, setRepoPath] = useState("")

  // Reset on close so a re-open starts fresh.
  useEffect(() => {
    if (!open) {
      setName("")
      setSlug("")
      setSlugTouched(false)
      setDescription("")
      setError(null)
      setRepoId("")
      setBranch("")
      setRepoPath("")
      setDirs(null)
    }
  }, [open])

  useEffect(() => {
    if (!open || !orgId) return
    let cancelled = false
    gitlabApi
      .list(orgId)
      .then((list) => {
        if (cancelled) return
        setIntegrations(list)
        if (list.length > 0) setIntegrationId(list[0].id)
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
      setRepoError(null)
      return
    }
    let cancelled = false
    setRepos(null)
    setRepoError(null)
    gitlabApi
      .listRepos(orgId, integrationId)
      .then((list) => {
        if (cancelled) return
        setRepos(list)
        if (list.length === 0) {
          setRepoError(
            "No repositories returned. Check the GitLab account's permissions.",
          )
        }
      })
      .catch((err) => {
        if (cancelled) return
        setRepos([])
        setRepoError(
          (err as { response?: { data?: { error?: string } } })?.response?.data
            ?.error ?? "Failed to list repositories.",
        )
      })
    return () => {
      cancelled = true
    }
  }, [orgId, integrationId])

  // After a repo is picked, default the branch to the repo's default branch
  // and load the directory list for the subfolder dropdown.
  useEffect(() => {
    if (!orgId || !integrationId || repoId === "") {
      setDirs(null)
      return
    }
    const repo = repos?.find((r) => r.id === repoId)
    if (repo) setBranch(repo.default_branch)
    setRepoPath("")
    if (!repo) return

    let cancelled = false
    setDirs(null)
    setDirError(null)
    gitlabApi
      .listDirs(orgId, integrationId, {
        repoId: repo.id,
        branch: repo.default_branch,
      })
      .then((list) => {
        if (!cancelled) setDirs(list)
      })
      .catch((err) => {
        if (cancelled) return
        setDirs([])
        setDirError(
          (err as { response?: { data?: { error?: string } } })?.response?.data
            ?.error ?? "Failed to list subfolders.",
        )
      })
    return () => {
      cancelled = true
    }
  }, [orgId, integrationId, repoId, repos])

  const selectedRepo = useMemo(
    () => (repoId === "" ? null : (repos?.find((r) => r.id === repoId) ?? null)),
    [repos, repoId],
  )

  const effectiveSlug = slugTouched ? slug : slugify(name)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !effectiveSlug) return
    setSaving(true)
    setError(null)
    try {
      await onCreate({
        name: name.trim(),
        slug: effectiveSlug,
        description: description.trim() ? description.trim() : null,
        gitlab:
          integrationId && selectedRepo
            ? {
                integration_id: integrationId,
                repo_id: selectedRepo.id,
                repo_name: selectedRepo.path_with_namespace,
                repo_url: selectedRepo.web_url,
                branch: branch || selectedRepo.default_branch,
                repo_path: repoPath,
              }
            : null,
      })
    } catch (err) {
      setError(
        (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error ?? "Failed to create project",
      )
    } finally {
      setSaving(false)
    }
  }

  const hasIntegration = (integrations?.length ?? 0) > 0

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>New project</DialogTitle>
        <DialogDescription>
          Give your project a name and an optional description.
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="project-name">
            Name
          </label>
          <Input
            id="project-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="UI"
            required
            autoFocus
            className="bg-muted/40 px-3"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="project-slug">
            Slug
          </label>
          <Input
            id="project-slug"
            value={effectiveSlug}
            onChange={(e) => {
              setSlugTouched(true)
              setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))
            }}
            placeholder="ui"
            required
            className="bg-muted/40 px-3 font-mono"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="project-description">
            Description{" "}
            <span className="text-muted-foreground font-normal">
              (optional)
            </span>
          </label>
          <textarea
            id="project-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="What does this project cover?"
            className="bg-muted/40 ring-border/40 placeholder:text-muted-foreground resize-y p-3 text-sm outline-none ring-1 focus-visible:ring-primary"
          />
        </div>

        {integrations === null ? null : hasIntegration ? (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium" htmlFor="add-project-repo">
                  Repository
                </label>
                <Select
                  value={repoId === "" ? undefined : String(repoId)}
                  onValueChange={(v) => setRepoId(v === "" ? "" : Number(v))}
                >
                  <SelectTrigger
                    id="add-project-repo"
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
                {repoError ? (
                  <p className="text-destructive text-xs">{repoError}</p>
                ) : null}
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
                htmlFor="add-project-subfolder"
                className="flex items-center gap-2 text-sm font-medium"
              >
                Subfolder{" "}
                <span className="text-muted-foreground font-normal">
                  (optional — leave blank to scan entire repo)
                </span>
              </label>
              <Select
                value={repoPath === "" ? "__root__" : repoPath}
                onValueChange={(v) => setRepoPath(v === "__root__" ? "" : v)}
                disabled={repoId === ""}
              >
                <SelectTrigger
                  id="add-project-subfolder"
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
              {dirError ? (
                <p className="text-destructive text-xs">{dirError}</p>
              ) : null}
            </div>
          </>
        ) : null}

        {error ? <p className="text-destructive text-sm">{error}</p> : null}

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving || !name.trim() || !effectiveSlug}>
            {saving ? <Loader2Icon className="size-4 animate-spin" /> : null}
            Create
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}

