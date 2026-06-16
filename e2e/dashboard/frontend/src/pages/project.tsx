import { useEffect, useMemo, useState } from "react"
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom"
import {
  ArrowLeftIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  FolderOpenIcon,
  GitBranchIcon,
  Loader2Icon,
  MonitorIcon,
  PlayIcon,
  RefreshCwIcon,
  SettingsIcon,
  UploadIcon,
} from "lucide-react"
import { toast } from "sonner"

import { EditProjectDialog } from "@/components/dialogs/edit-project-dialog"
import { SDrawLoader } from "@/components/loaders/SDrawLoader"
import { ScoutEmptyState } from "@/components/ScoutEmptyState"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useActiveOrg } from "@/lib/auth"
import {
  environmentsApi,
  foldersApi,
  gitlabApi,
  productsApi,
  runsApi,
  subProjectsApi,
  testsApi,
  type Environment,
  type Folder,
  type ImportResult,
  type Product,
  type SubProject,
  type TestCase,
} from "@/lib/scout-api"

// importToast surfaces an import summary as a single sonner toast.
function importToast(res: ImportResult) {
  const parts = [`${res.added} added`, `${res.updated} updated`]
  if (res.skipped > 0) parts.push(`${res.skipped} skipped`)
  if (res.deleted > 0) parts.push(`${res.deleted} removed`)
  if (res.added + res.updated === 0) {
    toast.error(`No tests imported (${parts.join(" · ")})`)
  } else {
    toast.success(`Imported: ${parts.join(" · ")}`)
  }
}

function readError(err: unknown, fallback: string) {
  return (
    (err as { response?: { data?: { error?: string } } })?.response?.data
      ?.error ?? fallback
  )
}

// Flatten every test-case id under a folder subtree (children + own tests).
function collectTestIds(node: Folder): string[] {
  const ids = (node.test_cases ?? []).map((t) => t.id)
  node.children?.forEach((c) => ids.push(...collectTestIds(c)))
  return ids
}

export default function ProjectPage() {
  const { slug } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const orgId = useActiveOrg()?.id ?? null

  const [product, setProduct] = useState<Product | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    if (!orgId || !slug) return
    let cancelled = false
    productsApi
      .list(orgId)
      .then((list) => {
        if (cancelled) return
        setProduct(list.find((p) => p.slug === slug) ?? null)
      })
      .catch((err) => {
        if (cancelled) return
        setProduct(null)
        setError(readError(err, "Failed to load project"))
      })
    return () => {
      cancelled = true
    }
  }, [orgId, slug])

  const handleSync = async () => {
    if (!orgId || !product?.gitlab) return
    setSyncing(true)
    setSyncMessage(null)
    setError(null)
    try {
      // Ensure the product has at least one subproject for the importer to write into.
      const subProjects = await subProjectsApi.list(orgId, product.id)
      if (subProjects.length === 0) {
        await subProjectsApi.create(orgId, product.id, {
          name: "Default",
          slug: "default",
        })
      }

      const result = await gitlabApi.syncProduct(orgId, product.id)
      const parts = [
        result.added ? `${result.added} added` : null,
        result.updated ? `${result.updated} updated` : null,
        result.deleted ? `${result.deleted} deleted` : null,
        result.skipped ? `${result.skipped} skipped` : null,
      ].filter(Boolean)
      setSyncMessage(
        parts.length ? `Sync complete — ${parts.join(", ")}` : "Sync complete",
      )
      setReloadKey((k) => k + 1)
      setTimeout(() => setSyncMessage(null), 5000)
    } catch (err) {
      setError(readError(err, "Failed to sync from GitLab"))
    } finally {
      setSyncing(false)
    }
  }

  if (product === undefined) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <SDrawLoader label="Loading project…" />
      </div>
    )
  }

  if (product === null) {
    return (
      <div className="flex flex-col gap-4">
        <Link
          to="/projects"
          className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-sm"
        >
          <ArrowLeftIcon className="size-4" /> Back to projects
        </Link>
        <h2 className="text-2xl font-semibold">Project not found</h2>
        {error ? (
          <p className="text-destructive text-sm">{error}</p>
        ) : (
          <p className="text-muted-foreground text-sm">
            We couldn&apos;t find a project with slug &ldquo;{slug}&rdquo;.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link
          to="/projects"
          className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-sm"
        >
          <ArrowLeftIcon className="size-4" /> Projects
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">
              {product.name}
            </h1>
            {product.description ? (
              <p className="text-muted-foreground mt-1 text-sm">
                {product.description}
              </p>
            ) : null}
            <p className="text-muted-foreground mt-1 font-mono text-xs">
              /{product.slug}
            </p>
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setSettingsOpen(true)}
            title="Project settings"
          >
            <SettingsIcon className="size-4" />
          </Button>
        </div>
        {syncMessage ? (
          <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">
            {syncMessage}
          </p>
        ) : null}
        {error ? (
          <p className="text-destructive mt-2 text-xs">{error}</p>
        ) : null}
      </div>

      {product.gitlab ? <GitlabSummary link={product.gitlab} /> : null}

      <ProjectContents
        orgId={orgId}
        product={product}
        reloadKey={reloadKey}
        onSync={product.gitlab ? handleSync : null}
        syncing={syncing}
      />

      <EditProjectDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        product={product}
        onSaved={(updated) => {
          setProduct(updated)
          if (updated.slug !== product.slug) {
            navigate(`/projects/${updated.slug}`, { replace: true })
          }
          setReloadKey((k) => k + 1)
        }}
      />
    </div>
  )
}

function FileIcon({ fileName }: { fileName: string }) {
  const isTs = /\.(ts|tsx)$/.test(fileName)
  const isJs = /\.(js|jsx)$/.test(fileName)
  if (isTs) {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center rounded-sm bg-blue-600 text-[7px] font-bold text-white">
        TS
      </span>
    )
  }
  if (isJs) {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center rounded-sm bg-amber-500 text-[7px] font-bold text-white">
        JS
      </span>
    )
  }
  return (
    <span className="flex size-4 shrink-0 items-center justify-center rounded-sm bg-zinc-500 text-[7px] font-bold text-white">
      F
    </span>
  )
}

function GitlabSummary({ link }: { link: NonNullable<Product["gitlab"]> }) {
  return (
    <div className="ring-border/40 flex flex-wrap items-center gap-x-4 gap-y-2 p-3 text-sm ring-1">
      <div className="flex items-center gap-2">
        <GitBranchIcon className="text-muted-foreground size-4" />
        <a
          href={link.repo_url}
          target="_blank"
          rel="noreferrer"
          className="hover:underline"
        >
          {link.repo_name}
        </a>
      </div>
      <span className="text-muted-foreground">
        branch <span className="text-foreground font-mono">{link.branch}</span>
      </span>
      <span className="text-muted-foreground">
        path{" "}
        <span className="text-foreground font-mono">
          {link.repo_path || "/"}
        </span>
      </span>
    </div>
  )
}

function ProjectContents({
  orgId,
  product,
  reloadKey,
  onSync,
  syncing,
}: {
  orgId: string | null
  product: Product
  reloadKey: number
  onSync: (() => void) | null
  syncing: boolean
}) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const spSlug = searchParams.get("sp")

  const [subProjects, setSubProjects] = useState<SubProject[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    subProjectsApi
      .list(orgId, product.id)
      .then((list) => {
        if (!cancelled) setSubProjects(list)
      })
      .catch((err) => {
        if (cancelled) return
        setSubProjects([])
        setError(readError(err, "Failed to load test suites"))
      })
    return () => {
      cancelled = true
    }
  }, [orgId, product.id, reloadKey])

  useEffect(() => {
    if (!subProjects || subProjects.length === 0) return
    const match = spSlug
      ? subProjects.find((sp) => sp.slug === spSlug)
      : undefined
    if (!match) {
      navigate(`/projects/${product.slug}?sp=${subProjects[0].slug}`, {
        replace: true,
      })
    }
  }, [subProjects, spSlug, navigate, product.slug])

  // Upload a zip from the empty state: ensure a "Default" sub-project exists,
  // import the specs into it, then refresh + navigate to it.
  const handleUploadEmpty = async (file: File): Promise<ImportResult> => {
    if (!orgId) throw new Error("no organisation")
    let target = subProjects?.[0]
    if (!target) {
      target = await subProjectsApi.create(orgId, product.id, {
        name: "Default",
        slug: "default",
      })
    }
    const res = await subProjectsApi.importZip(target.id, file)
    const list = await subProjectsApi.list(orgId, product.id)
    setSubProjects(list)
    importToast(res)
    navigate(`/projects/${product.slug}?sp=${target.slug}`, { replace: true })
    return res
  }

  if (subProjects === null) {
    return (
      <div className="ring-border/40 flex min-h-[20vh] items-center justify-center ring-1">
        <SDrawLoader label="Loading content…" />
      </div>
    )
  }

  if (subProjects.length === 0) {
    return (
      <div className="ring-border/40 flex min-h-[30vh] flex-col items-center justify-center gap-3 p-8 text-center ring-1">
        <ScoutEmptyState
          message="No content yet"
          sub={onSync
            ? "Sync from GitLab to import folders and tests, or initialize an empty project."
            : "Initialize this project to start adding folders and tests."}
        />
        {error ? <p className="text-destructive text-xs">{error}</p> : null}
        <div className="flex gap-2">
          {onSync ? (
            <Button onClick={onSync} disabled={syncing}>
              {syncing ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <RefreshCwIcon className="size-4" />
              )}
              {syncing ? "Syncing…" : "Sync from GitLab"}
            </Button>
          ) : null}
          <Button
            variant={onSync ? "outline" : "default"}
            onClick={() => setUploadOpen(true)}
            disabled={syncing}
          >
            <UploadIcon className="size-4" />
            Upload zip
          </Button>
        </div>
        <UploadZipDialog
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          onUpload={handleUploadEmpty}
        />
      </div>
    )
  }

  const active =
    subProjects.find((sp) => sp.slug === spSlug) ?? subProjects[0]

  return (
    <FolderTreeSection
      orgId={orgId}
      productId={product.id}
      spId={active.id}
      reloadKey={reloadKey}
      onSync={onSync}
      syncing={syncing}
    />
  )
}

const envStorageKey = (productId: string) =>
  `scout.project.${productId}.envId`

function FolderTreeSection({
  orgId,
  productId,
  spId,
  reloadKey,
  onSync,
  syncing,
}: {
  orgId: string | null
  productId: string
  spId: string
  reloadKey: number
  onSync: (() => void) | null
  syncing: boolean
}) {
  const navigate = useNavigate()
  const [folders, setFolders] = useState<Folder[] | null>(null)
  const [rootFolderId, setRootFolderId] = useState<string | null>(null)
  const [envs, setEnvs] = useState<Environment[] | null>(null)
  const [envId, setEnvId] = useState<string>("")
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [busyTarget, setBusyTarget] = useState<string | null>(null)
  const [headed, setHeaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [batchRunning, setBatchRunning] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [localReload, setLocalReload] = useState(0)

  useEffect(() => {
    let cancelled = false
    foldersApi
      .tree(spId)
      .then(async (list) => {
        if (cancelled) return

        // The /folders endpoint returns nested folders but with empty
        // test_cases — fetch tests per folder and merge them in.
        const allFolders: Folder[] = []
        const walkCollect = (n: Folder) => {
          allFolders.push(n)
          n.children?.forEach(walkCollect)
        }
        list.forEach(walkCollect)

        const testsByFolder = new Map<string, TestCase[]>()
        await Promise.all(
          allFolders.map(async (f) => {
            try {
              const tests = await foldersApi.listTests(f.id)
              testsByFolder.set(f.id, tests)
            } catch {
              testsByFolder.set(f.id, [])
            }
          }),
        )
        if (cancelled) return

        const inject = (n: Folder): Folder => ({
          ...n,
          test_cases: testsByFolder.get(n.id) ?? [],
          children: n.children?.map(inject),
        })
        const hydrated = list.map(inject)

        setFolders(hydrated)
        const ids = new Set<string>()
        const walkIds = (n: Folder) => {
          ids.add(n.id)
          n.children?.forEach(walkIds)
        }
        hydrated.forEach(walkIds)
        setExpanded(ids)
      })
      .catch((err) => {
        if (cancelled) return
        setFolders([])
        setError(readError(err, "Failed to load folders"))
      })
    return () => {
      cancelled = true
    }
  }, [spId, reloadKey, localReload])

  useEffect(() => {
    let cancelled = false
    subProjectsApi
      .rootFolder(spId)
      .then((id) => {
        if (!cancelled) setRootFolderId(id)
      })
      .catch(() => {
        /* non-fatal — Run all just won't work */
      })
    return () => {
      cancelled = true
    }
  }, [spId])

  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    environmentsApi
      .list(orgId)
      .then((list) => {
        if (cancelled) return
        setEnvs(list)
        const stored = localStorage.getItem(envStorageKey(productId))
        const initial =
          (stored && list.find((e) => e.id === stored)?.id) ||
          list[0]?.id ||
          ""
        setEnvId(initial)
      })
      .catch((err) => {
        if (cancelled) return
        setEnvs([])
        setError(readError(err, "Failed to load environments"))
      })
    return () => {
      cancelled = true
    }
  }, [orgId, productId])

  const onEnvChange = (id: string) => {
    setEnvId(id)
    if (id) localStorage.setItem(envStorageKey(productId), id)
    else localStorage.removeItem(envStorageKey(productId))
  }

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const startRun = async (
    target_type: "folder" | "test_case",
    target_id: string,
    label: string,
  ) => {
    if (!orgId) return
    if (!envId) {
      setError("Pick an environment before running.")
      return
    }
    setBusyTarget(target_id)
    setError(null)
    try {
      const { run_id } = await runsApi.start(orgId, {
        target_type,
        target_ids: [target_id],
        environment_id: envId,
        label,
        headed,
      })
      navigate(`/runs/${run_id}`)
    } catch (err) {
      setError(readError(err, "Failed to start run"))
    } finally {
      setBusyTarget(null)
    }
  }

  const toggleTest = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Select/deselect every test under a folder subtree at once.
  const toggleFolder = (testIds: string[], fullySelected: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (fullySelected) testIds.forEach((id) => next.delete(id))
      else testIds.forEach((id) => next.add(id))
      return next
    })
  }

  const clearSelection = () => setSelected(new Set())

  const runSelected = async () => {
    if (!orgId || selected.size === 0) return
    if (!envId) {
      setError("Pick an environment before running.")
      return
    }
    setBatchRunning(true)
    setError(null)
    try {
      const ids = Array.from(selected)
      const { run_id } = await runsApi.start(orgId, {
        target_type: "test_case",
        target_ids: ids,
        environment_id: envId,
        label: `${ids.length} test${ids.length === 1 ? "" : "s"}`,
      })
      navigate(`/runs/${run_id}`)
    } catch (err) {
      setError(readError(err, "Failed to start run"))
    } finally {
      setBatchRunning(false)
    }
  }

  if (folders === null) {
    return (
      <div className="ring-border/40 flex min-h-[20vh] items-center justify-center ring-1">
        <SDrawLoader label="Loading folders…" />
      </div>
    )
  }

  const noEnvs = envs !== null && envs.length === 0

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Folders & tests</h2>
          {selected.size > 0 ? (
            <span className="text-muted-foreground text-xs">
              {selected.size} selected
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {noEnvs ? (
            <Link
              to="/dashboard/settings/environments"
              className="text-muted-foreground hover:text-foreground text-xs underline"
            >
              Set up an environment
            </Link>
          ) : (
            <Select value={envId} onValueChange={onEnvChange}>
              <SelectTrigger size="sm" className="bg-background w-40">
                <SelectValue placeholder="Environment" />
              </SelectTrigger>
              <SelectContent>
                {envs?.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.label || e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={onSync ?? undefined}
            disabled={!onSync || syncing}
            title={
              onSync
                ? "Sync test files from GitLab"
                : "No GitLab configured — add it in project settings"
            }
          >
            {syncing ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <RefreshCwIcon className="size-4" />
            )}
            {syncing ? "Syncing…" : "Sync"}
          </Button>
          <button
            type="button"
            onClick={() => setHeaded((h) => !h)}
            className={`flex items-center gap-2 border px-3 py-1.5 text-sm transition-colors ${
              headed
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
            }`}
          >
            <MonitorIcon className="size-4 shrink-0" />
            <span className="hidden sm:inline">Watch live</span>
            <div
              className={`size-3.5 rounded-full border-2 transition-colors ${
                headed ? "border-primary bg-primary" : "border-muted-foreground"
              }`}
            />
          </button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setUploadOpen(true)}
          >
            <UploadIcon className="size-4" />
            Upload zip
          </Button>
          <Button
            size="sm"
            onClick={() => {
              if (rootFolderId) startRun("folder", rootFolderId, "Run all")
            }}
            disabled={
              !rootFolderId || !envId || busyTarget === rootFolderId
            }
          >
            {busyTarget === rootFolderId ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <PlayIcon className="size-4" />
            )}
            Run all
          </Button>
          {selected.size > 0 ? (
            <>
              <Button
                size="sm"
                onClick={runSelected}
                disabled={!envId || batchRunning}
              >
                {batchRunning ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  <PlayIcon className="size-4" />
                )}
                Run selected ({selected.size})
              </Button>
              <Button size="sm" variant="outline" onClick={clearSelection}>
                Clear
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {error ? <p className="text-destructive text-xs">{error}</p> : null}

      {!envId && envs && envs.length > 0 ? (
        <p className="text-muted-foreground text-xs">
          Pick an environment to enable the run buttons.
        </p>
      ) : null}
      {noEnvs ? (
        <p className="text-muted-foreground text-xs">
          No environments configured — runs are disabled.{" "}
          <Link
            to="/dashboard/settings/environments"
            className="underline hover:text-foreground"
          >
            Add one
          </Link>
          .
        </p>
      ) : null}

      <div className="bg-muted/30 ring-border/40 grid min-h-[40vh] grid-cols-1 ring-1 md:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
        <div className="border-border/40 overflow-auto border-b py-2 md:border-r md:border-b-0">
          {folders.length === 0 ? (
            <ScoutEmptyState message="No folders yet." sub="Sync from GitLab or add folders via the API." />
          ) : (
            folders.map((f) => (
              <FolderNode
                key={f.id}
                node={f}
                depth={0}
                expanded={expanded}
                onToggle={toggle}
                selectedTestId={selectedTestId}
                onSelectTest={setSelectedTestId}
                busyTarget={busyTarget}
                canRun={!!envId}
                onRun={startRun}
                selectedTests={selected}
                onToggleTest={toggleTest}
                onToggleFolder={toggleFolder}
              />
            ))
          )}
        </div>
        <div className="min-w-0 overflow-hidden">
          <FileViewer testId={selectedTestId} />
        </div>
      </div>

      <UploadZipDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onUpload={async (file) => {
          const res = await subProjectsApi.importZip(spId, file)
          importToast(res)
          setLocalReload((n) => n + 1)
          return res
        }}
      />
    </div>
  )
}

function FolderNode({
  node,
  depth,
  expanded,
  onToggle,
  selectedTestId,
  onSelectTest,
  busyTarget,
  canRun,
  onRun,
  selectedTests,
  onToggleTest,
  onToggleFolder,
}: {
  node: Folder
  depth: number
  expanded: Set<string>
  onToggle: (id: string) => void
  selectedTestId: string | null
  onSelectTest: (id: string) => void
  busyTarget: string | null
  canRun: boolean
  onRun: (
    target_type: "folder" | "test_case",
    target_id: string,
    label: string,
  ) => void
  selectedTests: Set<string>
  onToggleTest: (id: string) => void
  onToggleFolder: (testIds: string[], fullySelected: boolean) => void
}) {
  const open = expanded.has(node.id)
  const pad = 8 + depth * 14

  // Tri-state checkbox driven by how many descendant tests are selected.
  const descendantTestIds = useMemo(() => collectTestIds(node), [node])
  const selectedCount = descendantTestIds.filter((id) =>
    selectedTests.has(id),
  ).length
  const fullySelected =
    descendantTestIds.length > 0 && selectedCount === descendantTestIds.length
  const checkState: boolean | "indeterminate" = fullySelected
    ? true
    : selectedCount > 0
      ? "indeterminate"
      : false
  const anySelected = selectedCount > 0

  return (
    <div className="flex flex-col">
      <div
        className="hover:bg-muted/40 group flex items-center gap-1.5"
        style={{ paddingLeft: pad }}
      >
        {descendantTestIds.length > 0 ? (
          <Checkbox
            checked={checkState}
            onCheckedChange={() =>
              onToggleFolder(descendantTestIds, fullySelected)
            }
            aria-label={`Select all tests in ${node.name}`}
            className={`size-3.5 shrink-0 transition-opacity focus-visible:opacity-100 ${
              anySelected ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            }`}
          />
        ) : (
          <span className="size-3.5 shrink-0" />
        )}
        <button
          type="button"
          onClick={() => onToggle(node.id)}
          className="flex flex-1 items-center gap-1.5 py-1 text-left text-sm"
        >
          {open ? (
            <ChevronDownIcon className="text-muted-foreground size-3.5 shrink-0" />
          ) : (
            <ChevronRightIcon className="text-muted-foreground size-3.5 shrink-0" />
          )}
          {open ? (
            <FolderOpenIcon className="size-4 shrink-0 text-amber-400" />
          ) : (
            <FolderIcon className="size-4 shrink-0 text-amber-400" />
          )}
          <span className="truncate font-mono text-xs">{node.name}</span>
        </button>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onRun("folder", node.id, node.name)
              }}
              disabled={!canRun || busyTarget === node.id}
              className="text-muted-foreground hover:text-foreground disabled:pointer-events-none flex size-6 shrink-0 items-center justify-center opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100 focus-visible:opacity-100"
            >
              {busyTarget === node.id ? (
                <Loader2Icon className="size-3.5 animate-spin" />
              ) : (
                <PlayIcon className="size-3.5" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {canRun ? "Run folder" : "Pick an environment first"}
          </TooltipContent>
        </Tooltip>
      </div>
      {open ? (
        <>
          {node.children?.map((child) => (
            <FolderNode
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              selectedTestId={selectedTestId}
              onSelectTest={onSelectTest}
              busyTarget={busyTarget}
              canRun={canRun}
              onRun={onRun}
              selectedTests={selectedTests}
              onToggleTest={onToggleTest}
              onToggleFolder={onToggleFolder}
            />
          ))}
          {node.test_cases?.map((t) => (
            <TestRow
              key={t.id}
              test={t}
              depth={depth + 1}
              selected={selectedTestId === t.id}
              onSelect={() => onSelectTest(t.id)}
              busy={busyTarget === t.id}
              canRun={canRun}
              onRun={() => onRun("test_case", t.id, t.name)}
              checked={selectedTests.has(t.id)}
              onToggleCheck={() => onToggleTest(t.id)}
            />
          ))}
        </>
      ) : null}
    </div>
  )
}

function TestRow({
  test,
  depth,
  selected,
  onSelect,
  busy,
  canRun,
  onRun,
  checked,
  onToggleCheck,
}: {
  test: TestCase
  depth: number
  selected: boolean
  onSelect: () => void
  busy: boolean
  canRun: boolean
  onRun: () => void
  checked: boolean
  onToggleCheck: () => void
}) {
  const pad = 8 + depth * 14
  return (
    <div
      className={`group flex items-center gap-1.5 ${
        selected ? "bg-muted/60" : "hover:bg-muted/40"
      }`}
      style={{ paddingLeft: pad }}
    >
      <Checkbox
        checked={checked}
        onCheckedChange={() => onToggleCheck()}
        aria-label={`Select ${test.file_name}`}
        className={`size-3.5 shrink-0 transition-opacity focus-visible:opacity-100 ${
          checked ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        }`}
      />
      <button
        type="button"
        onClick={onSelect}
        className="flex flex-1 items-center gap-1.5 py-1 text-left text-sm"
      >
        <span className="size-3.5 shrink-0" />
        <FileIcon fileName={test.file_name} />
        <span className="truncate font-mono text-xs">{test.file_name}</span>
      </button>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onRun()
            }}
            disabled={!canRun || busy}
            className="text-muted-foreground hover:text-foreground disabled:pointer-events-none flex size-6 shrink-0 items-center justify-center opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100 focus-visible:opacity-100"
          >
            {busy ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : (
              <PlayIcon className="size-3.5" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent>
          {canRun ? "Run test" : "Pick an environment first"}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

function FileViewer({ testId }: { testId: string | null }) {
  const [test, setTest] = useState<TestCase | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!testId) {
      setTest(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    testsApi
      .get(testId)
      .then((t) => {
        if (!cancelled) setTest(t)
      })
      .catch((err) => {
        if (cancelled) return
        setTest(null)
        setError(readError(err, "Failed to load test"))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [testId])

  const lines = useMemo(
    () => (test?.file_content ?? "").split("\n"),
    [test?.file_content],
  )

  if (!testId) {
    return (
      <div className="flex h-full min-h-[40vh] items-center justify-center">
        <ScoutEmptyState message="No test selected" sub="Select a test file from the tree to view its contents." />
      </div>
    )
  }
  if (loading) {
    return (
      <div className="flex h-full min-h-[40vh] items-center justify-center">
        <SDrawLoader label="Loading test…" />
      </div>
    )
  }
  if (error || !test) {
    return (
      <div className="text-destructive p-6 text-sm">
        {error ?? "Test not found"}
      </div>
    )
  }
  return (
    <div className="flex min-w-0 flex-col">
      <div className="border-border/40 flex items-center gap-2 border-b px-3 py-2">
        <FileIcon fileName={test.file_name} />
        <span className="truncate text-sm font-semibold">{test.name}</span>
        <span className="text-muted-foreground ml-auto font-mono text-xs">
          v{test.version}
        </span>
      </div>
      <pre className="min-w-0 overflow-x-auto p-3 font-mono text-xs leading-5">
        {lines.map((line, i) => (
          <div key={i} className="flex">
            <span className="text-muted-foreground w-8 shrink-0 select-none text-right">
              {i + 1}
            </span>
            <span className="pl-3 whitespace-pre">{line || " "}</span>
          </div>
        ))}
      </pre>
    </div>
  )
}
