import { useCallback, useEffect, useState } from "react"
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClockIcon,
  ExternalLinkIcon,
  Loader2Icon,
  PlayIcon,
  PlusIcon,
  Trash2Icon,
  TriangleAlertIcon,
  XCircleIcon,
} from "lucide-react"
import { useNavigate } from "react-router-dom"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { useActiveOrg } from "@/lib/auth"
import {
  youtrackApi,
  type YouTrackBoard,
  type YouTrackIntegration,
  type YouTrackIssue,
  type YouTrackSprint,
  type YouTrackTicketMapping,
} from "@/lib/scout-api"

type ApiError = { response?: { data?: { error?: string } } }
function readError(err: unknown, fallback: string) {
  return (err as ApiError)?.response?.data?.error ?? fallback
}

// ── State badge helpers ───────────────────────────────────────────────────────

const STATE_COLORS: Record<string, string> = {
  open:             "bg-zinc-500/10 text-zinc-300 ring-zinc-500/30",
  "in progress":    "bg-sky-500/10 text-sky-300 ring-sky-500/30",
  dev:              "bg-violet-500/10 text-violet-300 ring-violet-500/30",
  "ready for stage":"bg-amber-500/10 text-amber-300 ring-amber-500/30",
  stage:            "bg-blue-500/10 text-blue-300 ring-blue-500/30",
  "ready for prod": "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30",
  "ready for production":"bg-emerald-500/10 text-emerald-300 ring-emerald-500/30",
  prod:             "bg-green-600/10 text-green-300 ring-green-600/30",
  production:       "bg-green-600/10 text-green-300 ring-green-600/30",
  done:             "bg-green-600/10 text-green-300 ring-green-600/30",
  fixed:            "bg-green-600/10 text-green-300 ring-green-600/30",
}

function stateCls(state: string) {
  return STATE_COLORS[state.toLowerCase()] ?? "bg-zinc-500/10 text-zinc-300 ring-zinc-500/30"
}

const PRIORITY_DOT: Record<string, string> = {
  critical: "bg-red-500",
  major:    "bg-orange-500",
  normal:   "bg-yellow-500",
  minor:    "bg-blue-400",
  trivial:  "bg-zinc-500",
}

function priorityDot(priority: string) {
  return PRIORITY_DOT[priority.toLowerCase()] ?? "bg-zinc-500"
}

// ── Connect Form ──────────────────────────────────────────────────────────────

function ConnectForm({
  orgId,
  onConnected,
}: {
  orgId: string
  onConnected: (integration: YouTrackIntegration) => void
}) {
  const [baseUrl, setBaseUrl] = useState("")
  const [token, setToken] = useState("")
  const [projectId, setProjectId] = useState("")
  const [boardId, setBoardId] = useState("")
  const [boards, setBoards] = useState<YouTrackBoard[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [loadingBoards, setLoadingBoards] = useState(false)
  const [error, setError] = useState("")

  const handleConnect = async () => {
    if (!baseUrl.trim() || !token.trim() || !projectId.trim()) {
      setError("Base URL, token and project ID are required")
      return
    }
    setSaving(true)
    setError("")
    try {
      const integration = await youtrackApi.connect(orgId, {
        base_url: baseUrl.trim(),
        token: token.trim(),
        project_id: projectId.trim(),
        board_id: boardId.trim() || undefined,
      })
      onConnected(integration)
    } catch (err) {
      setError(readError(err, "Connection failed — check your credentials"))
    } finally {
      setSaving(false)
    }
  }

  // After connecting, optionally fetch boards so user can pick one
  const fetchBoards = async () => {
    if (!baseUrl.trim() || !token.trim() || !projectId.trim()) return
    setLoadingBoards(true)
    setError("")
    try {
      const integration = await youtrackApi.connect(orgId, {
        base_url: baseUrl.trim(),
        token: token.trim(),
        project_id: projectId.trim(),
      })
      const list = await youtrackApi.getBoards(orgId, integration.id)
      setBoards(list)
      onConnected(integration) // save even without board selection
    } catch (err) {
      setError(readError(err, "Connection failed"))
    } finally {
      setLoadingBoards(false)
    }
  }
  void fetchBoards // suppress unused warning

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-base font-semibold">Connect YouTrack</h2>
        <p className="text-muted-foreground mt-0.5 text-sm">
          Enter your YouTrack instance URL, a permanent token, and your project
          short name (e.g.{" "}
          <span className="font-mono text-xs">ARD</span>). Sprints and issues
          will be fetched automatically.
        </p>
      </div>

      <div className="grid gap-3">
        <div className="space-y-1">
          <Label htmlFor="yt-url">Instance URL</Label>
          <Input
            id="yt-url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://youtrack.example.com"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="yt-token">Permanent Token</Label>
          <Input
            id="yt-token"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="perm:..."
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="yt-project">Project ID</Label>
            <Input
              id="yt-project"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              placeholder="ARD"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="yt-board">
              Board ID{" "}
              <span className="text-muted-foreground text-xs">(optional)</span>
            </Label>
            {boards ? (
              <select
                className="border-input bg-background w-full rounded border px-3 py-1.5 text-sm"
                value={boardId}
                onChange={(e) => setBoardId(e.target.value)}
              >
                <option value="">Auto-detect</option>
                {boards.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                id="yt-board"
                value={boardId}
                onChange={(e) => setBoardId(e.target.value)}
                placeholder="0-1"
              />
            )}
          </div>
        </div>
      </div>

      {error && (
        <p className="flex items-center gap-1.5 text-sm text-red-400">
          <XCircleIcon className="h-4 w-4 shrink-0" />
          {error}
        </p>
      )}

      <Button onClick={handleConnect} disabled={saving || loadingBoards}>
        {saving || loadingBoards ? (
          <Loader2Icon className="h-4 w-4 animate-spin" />
        ) : null}
        Connect YouTrack
      </Button>
    </div>
  )
}

// ── Map Test Dialog ───────────────────────────────────────────────────────────

function MapTestDialog({
  orgId,
  issue,
  open,
  onOpenChange,
  onMapped,
}: {
  orgId: string
  issue: YouTrackIssue
  open: boolean
  onOpenChange: (v: boolean) => void
  onMapped: (mapping: YouTrackTicketMapping) => void
}) {
  const [testCaseId, setTestCaseId] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  const handleMap = async () => {
    if (!testCaseId.trim()) {
      setError("Test case ID is required")
      return
    }
    setSaving(true)
    setError("")
    try {
      const mapping = await youtrackApi.createMapping(orgId, {
        ticket_id: issue.ticket_key,
        ticket_title: issue.summary,
        test_case_id: testCaseId.trim(),
      })
      onMapped(mapping)
      setTestCaseId("")
      onOpenChange(false)
    } catch (err) {
      setError(readError(err, "Failed to save mapping"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Map test to {issue.ticket_key}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-muted-foreground text-sm">{issue.summary}</p>
          <div className="space-y-1">
            <Label htmlFor="tc-id">Test Case ID (UUID)</Label>
            <Input
              id="tc-id"
              value={testCaseId}
              onChange={(e) => setTestCaseId(e.target.value)}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleMap} disabled={saving}>
            {saving && <Loader2Icon className="h-4 w-4 animate-spin" />}
            Save mapping
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Issue Row ─────────────────────────────────────────────────────────────────

function IssueRow({
  orgId,
  issue,
  onMappingAdded,
  onMappingRemoved,
}: {
  orgId: string
  issue: YouTrackIssue
  onMappingAdded: (mapping: YouTrackTicketMapping) => void
  onMappingRemoved: (mappingId: string) => void
}) {
  const [mapOpen, setMapOpen] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)

  const removeMapping = async (mappingId: string) => {
    setRemoving(mappingId)
    try {
      await youtrackApi.deleteMapping(orgId, mappingId)
      onMappingRemoved(mappingId)
    } finally {
      setRemoving(null)
    }
  }

  const covered = issue.mappings.length > 0

  return (
    <div className="border-border space-y-2 border-b px-4 py-3 last:border-0">
      <div className="flex items-start gap-3">
        <div className="flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground font-mono text-xs">
              {issue.ticket_key}
            </span>
            <span className="font-medium leading-snug">{issue.summary}</span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {issue.status && (
              <span
                className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${stateCls(issue.status)}`}
              >
                {issue.status}
              </span>
            )}
            {issue.priority && issue.priority !== "Normal" && (
              <span className="flex items-center gap-1 text-[11px] text-zinc-400">
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${priorityDot(issue.priority)}`}
                />
                {issue.priority}
              </span>
            )}
            {issue.subsystem && (
              <span className="text-muted-foreground text-[11px]">
                {issue.subsystem}
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {covered ? (
            <span className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald-300 ring-1 ring-inset ring-emerald-500/30">
              <CheckCircle2Icon className="h-3 w-3" />
              {issue.mappings.length} test{issue.mappings.length !== 1 ? "s" : ""}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded bg-zinc-500/10 px-1.5 py-0.5 text-[11px] text-zinc-400 ring-1 ring-inset ring-zinc-500/30">
              <TriangleAlertIcon className="h-3 w-3" />
              No tests
            </span>
          )}
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setMapOpen(true)}>
            <PlusIcon className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {issue.mappings.length > 0 && (
        <div className="ml-1 flex flex-wrap gap-1.5">
          {issue.mappings.map((m) => (
            <span
              key={m.id}
              className="border-border inline-flex items-center gap-1 rounded border bg-zinc-900 px-2 py-0.5 text-[11px]"
            >
              {m.test_case_name || m.test_case_id.slice(0, 8)}
              <button
                onClick={() => void removeMapping(m.id)}
                disabled={removing === m.id}
                className="text-muted-foreground hover:text-foreground ml-0.5"
              >
                {removing === m.id ? (
                  <Loader2Icon className="h-3 w-3 animate-spin" />
                ) : (
                  <Trash2Icon className="h-3 w-3" />
                )}
              </button>
            </span>
          ))}
        </div>
      )}

      <MapTestDialog
        orgId={orgId}
        issue={issue}
        open={mapOpen}
        onOpenChange={setMapOpen}
        onMapped={onMappingAdded}
      />
    </div>
  )
}

// ── Sprint Card ───────────────────────────────────────────────────────────────

function SprintCard({
  orgId,
  integrationId,
  sprint,
}: {
  orgId: string
  integrationId: string
  sprint: YouTrackSprint
}) {
  const navigate = useNavigate()
  const [expanded, setExpanded] = useState(false)
  const [issues, setIssues] = useState<YouTrackIssue[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [running, setRunning] = useState(false)
  const [toast, setToast] = useState("")

  const loadIssues = useCallback(async () => {
    if (issues !== null) return
    setLoading(true)
    setError("")
    try {
      const data = await youtrackApi.getSprintIssues(orgId, integrationId, sprint.id)
      setIssues(data)
    } catch (err) {
      setError(readError(err, "Failed to load sprint issues"))
    } finally {
      setLoading(false)
    }
  }, [orgId, integrationId, sprint.id, issues])

  const handleExpand = () => {
    setExpanded((v) => !v)
    if (!expanded && issues === null) {
      void loadIssues()
    }
  }

  const handleRun = async () => {
    setRunning(true)
    try {
      const result = await youtrackApi.runSprint(orgId, integrationId, sprint.id, {
        label: `Sprint: ${sprint.name}`,
      })
      navigate(`/runs/${result.run_id}`)
    } catch (err) {
      setToast(readError(err, "Failed to start run"))
      setTimeout(() => setToast(""), 4000)
    } finally {
      setRunning(false)
    }
  }

  const handleMappingAdded = (mapping: YouTrackTicketMapping) => {
    setIssues((prev) =>
      prev
        ? prev.map((iss) =>
            iss.ticket_key === mapping.ticket_id
              ? { ...iss, mappings: [...iss.mappings, mapping] }
              : iss,
          )
        : prev,
    )
  }

  const handleMappingRemoved = (mappingId: string) => {
    setIssues((prev) =>
      prev
        ? prev.map((iss) => ({
            ...iss,
            mappings: iss.mappings.filter((m) => m.id !== mappingId),
          }))
        : prev,
    )
  }

  const totalMapped = issues?.reduce((n, iss) => n + iss.mappings.length, 0) ?? 0
  const coveredCount = issues?.filter((iss) => iss.mappings.length > 0).length ?? 0
  const sprintDate = sprint.start
    ? new Date(sprint.start).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
    : null

  return (
    <div className="ring-border/40 overflow-hidden ring-1">
      {/* Header */}
      <div
        className="hover:bg-muted/20 flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors"
        onClick={handleExpand}
      >
        <button className="text-muted-foreground shrink-0">
          {expanded ? (
            <ChevronDownIcon className="h-4 w-4" />
          ) : (
            <ChevronRightIcon className="h-4 w-4" />
          )}
        </button>

        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{sprint.name}</span>
            {!sprint.isCompleted && (
              <span className="rounded bg-sky-500/10 px-1.5 py-0.5 text-[11px] font-medium text-sky-300 ring-1 ring-inset ring-sky-500/30">
                Active
              </span>
            )}
            {sprint.isCompleted && (
              <span className="rounded bg-zinc-500/10 px-1.5 py-0.5 text-[11px] text-zinc-400 ring-1 ring-inset ring-zinc-500/30">
                Completed
              </span>
            )}
          </div>
          {sprintDate && (
            <p className="text-muted-foreground mt-0.5 text-xs">
              <ClockIcon className="mr-1 inline h-3 w-3" />
              {sprintDate}
            </p>
          )}
        </div>

        {issues !== null && (
          <div className="text-muted-foreground text-right text-xs">
            <p>
              {coveredCount}/{issues.length} issues covered
            </p>
            <p>{totalMapped} test{totalMapped !== 1 ? "s" : ""} mapped</p>
          </div>
        )}

        <Button
          size="sm"
          variant={issues !== null && totalMapped > 0 ? "default" : "outline"}
          disabled={running || (issues !== null && totalMapped === 0)}
          onClick={(e) => {
            e.stopPropagation()
            void handleRun()
          }}
          title={
            issues !== null && totalMapped === 0
              ? "Map tests to tickets first"
              : "Run all mapped tests"
          }
        >
          {running ? (
            <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <PlayIcon className="h-3.5 w-3.5" />
          )}
          Run Sprint Tests
        </Button>
      </div>

      {toast && (
        <div className="border-t border-rose-500/20 bg-rose-500/5 px-4 py-2 text-sm text-rose-400">
          {toast}
        </div>
      )}

      {/* Issues */}
      {expanded && (
        <div className="border-t border-border">
          {loading && (
            <div className="space-y-2 p-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          )}
          {error && (
            <p className="px-4 py-3 text-sm text-red-400">{error}</p>
          )}
          {issues !== null && issues.length === 0 && (
            <p className="text-muted-foreground px-4 py-3 text-sm">
              No issues in this sprint.
            </p>
          )}
          {issues !== null &&
            issues.map((issue) => (
              <IssueRow
                key={issue.id}
                orgId={orgId}
                issue={issue}
                onMappingAdded={handleMappingAdded}
                onMappingRemoved={handleMappingRemoved}
              />
            ))}
        </div>
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SprintsPage() {
  const org = useActiveOrg()
  const [integration, setIntegration] = useState<YouTrackIntegration | null | undefined>(
    undefined, // undefined = loading, null = not connected
  )
  const [sprints, setSprints] = useState<YouTrackSprint[] | null>(null)
  const [loadingSprints, setLoadingSprints] = useState(false)
  const [error, setError] = useState("")

  // Check connection status on mount
  useEffect(() => {
    if (!org) return
    let cancelled = false
    youtrackApi.getStatus(org.id).then((res) => {
      if (cancelled) return
      setIntegration(res.connected && res.integration ? res.integration : null)
    }).catch(() => {
      if (!cancelled) setIntegration(null)
    })
    return () => { cancelled = true }
  }, [org?.id])

  // Load sprints when connected
  const loadSprints = useCallback(() => {
    if (!org || !integration) return
    setLoadingSprints(true)
    setError("")
    youtrackApi.getSprints(org.id, integration.id).then((data) => {
      setSprints(data)
    }).catch((err) => {
      setError(readError(err, "Failed to load sprints"))
    }).finally(() => setLoadingSprints(false))
  }, [org?.id, integration?.id])

  useEffect(() => {
    if (integration) loadSprints()
  }, [integration?.id])

  if (!org) return null

  // Loading state
  if (integration === undefined) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  // Not connected
  if (integration === null) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold">Sprints</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            Connect YouTrack to view sprints, map tickets to test specs, and run coverage checks.
          </p>
        </div>
        <div className="ring-border/40 max-w-lg p-6 ring-1">
          <ConnectForm orgId={org.id} onConnected={setIntegration} />
        </div>
      </div>
    )
  }

  // Connected
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Sprints</h1>
          <p className="text-muted-foreground mt-0.5 text-sm">
            {integration.base_url}{" "}
            <span className="font-mono">·</span>{" "}
            project <span className="font-mono text-xs">{integration.project_id}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={loadSprints} disabled={loadingSprints}>
            {loadingSprints ? (
              <Loader2Icon className="h-4 w-4 animate-spin" />
            ) : (
              <ExternalLinkIcon className="h-4 w-4" />
            )}
            Refresh
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-rose-400 hover:text-rose-300"
            onClick={async () => {
              await youtrackApi.disconnect(org.id, integration.id)
              setIntegration(null)
              setSprints(null)
            }}
          >
            Disconnect
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded bg-rose-500/10 px-4 py-2 text-sm text-rose-400 ring-1 ring-inset ring-rose-500/30">
          <XCircleIcon className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {loadingSprints && sprints === null && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      )}

      {sprints !== null && sprints.length === 0 && (
        <div className="ring-border/40 flex flex-col items-center gap-3 py-16 text-center ring-1">
          <ClockIcon className="text-muted-foreground/30 h-10 w-10" />
          <p className="text-muted-foreground text-sm">
            No sprints found for project{" "}
            <span className="font-mono">{integration.project_id}</span>.
          </p>
        </div>
      )}

      {sprints !== null && sprints.length > 0 && (
        <div className="space-y-3">
          {/* Active sprints first, then by recency */}
          {[...sprints]
            .sort((a, b) => Number(a.isCompleted) - Number(b.isCompleted))
            .map((sprint) => (
              <SprintCard
                key={sprint.id}
                orgId={org.id}
                integrationId={integration.id}
                sprint={sprint}
              />
            ))}
        </div>
      )}
    </div>
  )
}
