import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  FolderOpenIcon,
  Loader2Icon,
  MonitorIcon,
  PlayIcon,
  RefreshCwIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
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
  specsApi,
  type Environment,
  type SpecNode,
} from "@/lib/scout-api"

function readError(err: unknown, fallback: string) {
  return (
    (err as { response?: { data?: { error?: string } } })?.response?.data
      ?.error ?? fallback
  )
}

// ── File icon ─────────────────────────────────────────────────────────────────

function FileIcon({ name }: { name: string }) {
  const lower = name.toLowerCase()
  if (lower.endsWith(".ts") || lower.endsWith(".tsx")) {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center rounded-sm bg-blue-600 text-[7px] font-bold text-white leading-none">
        TS
      </span>
    )
  }
  if (lower.endsWith(".js") || lower.endsWith(".jsx")) {
    return (
      <span className="flex size-4 shrink-0 items-center justify-center rounded-sm bg-amber-500 text-[7px] font-bold text-white leading-none">
        JS
      </span>
    )
  }
  return (
    <span className="flex size-4 shrink-0 items-center justify-center rounded-sm bg-zinc-500 text-[7px] font-bold text-white leading-none">
      F
    </span>
  )
}

// ── Tree node ─────────────────────────────────────────────────────────────────

function SpecTreeNode({
  node,
  depth,
  expanded,
  onToggle,
  selected,
  onSelect,
  busyPath,
  canRun,
  onRun,
}: {
  node: SpecNode
  depth: number
  expanded: Set<string>
  onToggle: (path: string) => void
  selected: Set<string>
  onSelect: (path: string, multi: boolean) => void
  busyPath: string | null
  canRun: boolean
  onRun: (paths: string[], label: string, key: string) => void
}) {
  const open = expanded.has(node.path)
  const isSelected = selected.has(node.path)
  const pad = 8 + depth * 14

  if (node.is_dir) {
    // Collect all file paths under this dir recursively
    const collectPaths = (n: SpecNode): string[] => {
      if (!n.is_dir) return [n.path]
      return (n.children ?? []).flatMap(collectPaths)
    }
    const dirPaths = collectPaths(node)

    return (
      <div>
        <div
          className="hover:bg-muted/40 group flex items-center gap-1"
          style={{ paddingLeft: pad }}
        >
          <button
            type="button"
            onClick={() => onToggle(node.path)}
            className="flex flex-1 items-center gap-1.5 py-[3px] text-left"
          >
            <span className="text-muted-foreground size-3.5 shrink-0">
              {open ? <ChevronDownIcon className="size-3.5" /> : <ChevronRightIcon className="size-3.5" />}
            </span>
            {open
              ? <FolderOpenIcon className="size-4 shrink-0 text-amber-400" />
              : <FolderIcon className="size-4 shrink-0 text-amber-400" />}
            <span className="truncate font-mono text-xs">{node.name}</span>
          </button>
          <button
            type="button"
            disabled={!canRun || busyPath === node.path}
            title={canRun ? `Run all in ${node.name}` : "Pick an environment first"}
            onClick={(e) => { e.stopPropagation(); onRun(dirPaths, node.name, node.path) }}
            className="invisible flex size-6 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30 group-hover:visible"
          >
            {busyPath === node.path
              ? <Loader2Icon className="size-3.5 animate-spin" />
              : <PlayIcon className="size-3.5" />}
          </button>
        </div>
        {open && (
          <div>
            {(node.children ?? []).map((child) => (
              <SpecTreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                expanded={expanded}
                onToggle={onToggle}
                selected={selected}
                onSelect={onSelect}
                busyPath={busyPath}
                canRun={canRun}
                onRun={onRun}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  // File node
  return (
    <div
      className={`group flex items-center gap-1 ${isSelected ? "bg-muted/60" : "hover:bg-muted/40"}`}
      style={{ paddingLeft: pad }}
    >
      <button
        type="button"
        onClick={(e) => onSelect(node.path, e.ctrlKey || e.metaKey)}
        className="flex flex-1 items-center gap-1.5 py-[3px] text-left"
      >
        <span className="size-3.5 shrink-0" />
        <FileIcon name={node.name} />
        <span className="truncate font-mono text-xs">{node.name}</span>
      </button>
      <button
        type="button"
        disabled={!canRun || busyPath === node.path}
        title={canRun ? `Run ${node.name}` : "Pick an environment first"}
        onClick={(e) => { e.stopPropagation(); onRun([node.path], node.name, node.path) }}
        className="invisible flex size-6 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-30 group-hover:visible"
      >
        {busyPath === node.path
          ? <Loader2Icon className="size-3.5 animate-spin" />
          : <PlayIcon className="size-3.5" />}
      </button>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SpecsPage() {
  const navigate = useNavigate()
  const org = useActiveOrg()
  const orgId = org?.id ?? null

  const [nodes, setNodes] = useState<SpecNode[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [envs, setEnvs] = useState<Environment[] | null>(null)
  const [envId, setEnvId] = useState("")

  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busyPath, setBusyPath] = useState<string | null>(null)
  const [headed, setHeaded] = useState(false)

  // Load environments
  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    environmentsApi.list(orgId).then((list) => {
      if (cancelled) return
      setEnvs(list)
      setEnvId((prev) => prev || list[0]?.id || "")
    }).catch(() => { if (!cancelled) setEnvs([]) })
    return () => { cancelled = true }
  }, [orgId])

  const loadTree = () => {
    if (!orgId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    specsApi.tree(orgId).then(({ nodes: n }) => {
      if (cancelled) return
      setNodes(n ?? [])
      // Auto-expand top-level dirs
      const ids = new Set<string>()
      ;(n ?? []).forEach((node) => { if (node.is_dir) ids.add(node.path) })
      setExpanded(ids)
    }).catch((err) => {
      if (cancelled) return
      setNodes([])
      setError(readError(err, "Failed to load spec files"))
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }

  useEffect(() => loadTree() ?? undefined, [orgId]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(path) ? next.delete(path) : next.add(path)
      return next
    })

  const selectFile = (path: string, multi: boolean) =>
    setSelected((prev) => {
      const next = multi ? new Set(prev) : new Set<string>()
      next.has(path) ? next.delete(path) : next.add(path)
      return next
    })

  const runSpecs = async (paths: string[], label: string, key?: string) => {
    if (!orgId || !envId) { setError("Pick an environment first."); return }
    setBusyPath(key ?? paths[0])
    setError(null)
    try {
      const { run_id } = await specsApi.run(orgId, {
        paths,
        environment_id: envId,
        label,
        headed,
      })
      navigate(`/runs/${run_id}`)
    } catch (err) {
      setError(readError(err, "Failed to start run"))
    } finally {
      setBusyPath(null)
    }
  }

  const runSelected = () => {
    const paths = [...selected]
    if (paths.length === 0) return
    runSpecs(paths, `${paths.length} spec${paths.length > 1 ? "s" : ""}`)
  }

  const noEnvs = envs !== null && envs.length === 0

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Specs</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Local Playwright spec files — click{" "}
            <PlayIcon className="inline size-3" /> to run
          </p>
        </div>
        <div className="flex items-center gap-2">
          {noEnvs ? (
            <span className="text-muted-foreground text-xs">No environments configured</span>
          ) : (
            <Select value={envId} onValueChange={setEnvId}>
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
          {selected.size > 0 && (
            <Button size="sm" onClick={runSelected} disabled={!envId || !!busyPath}>
              <PlayIcon className="size-4" />
              Run {selected.size} selected
            </Button>
          )}
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
            onClick={loadTree}
            disabled={loading}
          >
            {loading ? <Loader2Icon className="size-4 animate-spin" /> : <RefreshCwIcon className="size-4" />}
            Refresh
          </Button>
        </div>
      </div>

      {error && <p className="text-destructive text-xs">{error}</p>}

      <div className="ring-border/40 bg-muted/20 min-h-[60vh] ring-1">
        {loading && nodes === null ? (
          <div className="flex min-h-[40vh] items-center justify-center">
            <Loader2Icon className="text-muted-foreground size-5 animate-spin" />
          </div>
        ) : nodes?.length === 0 ? (
          <div className="text-muted-foreground flex min-h-[40vh] flex-col items-center justify-center gap-2 p-6 text-center text-sm">
            <p>No spec files found.</p>
            <p className="text-xs">Make sure <code>SCOUT_PLAYWRIGHT_PROJECT_DIR</code> is set and a <code>specs/</code> directory exists.</p>
          </div>
        ) : (
          <div className="py-2">
            {(nodes ?? []).map((node) => (
              <SpecTreeNode
                key={node.path}
                node={node}
                depth={0}
                expanded={expanded}
                onToggle={toggle}
                selected={selected}
                onSelect={selectFile}
                busyPath={busyPath}
                canRun={!!envId}
                onRun={runSpecs}
              />
            ))}
          </div>
        )}
      </div>

      {!noEnvs && !envId && (
        <p className="text-muted-foreground text-xs">
          Select an environment above to enable the run buttons.
        </p>
      )}
      {selected.size > 0 && (
        <p className="text-muted-foreground text-xs">
          {selected.size} file{selected.size > 1 ? "s" : ""} selected — hold Ctrl/⌘ to multi-select
        </p>
      )}
    </div>
  )
}
