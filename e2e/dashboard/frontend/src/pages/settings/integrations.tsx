import { useEffect, useState } from "react"
import {
  CheckCircle2Icon,
  Loader2Icon,
  Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"

import GitlabIcon from "@/assets/GitlabIcon"
import SlackIcon from "@/assets/SlackIcon"
import YoutrackIcon from "@/assets/YoutrackIcon"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { useActiveOrg } from "@/lib/auth"
import {
  gitlabApi,
  slackApi,
  youtrackApi,
  type GitlabIntegration,
  type SlackSettings,
  type YouTrackIntegration,
} from "@/lib/scout-api"

type ApiError = { response?: { data?: { error?: string } } }

function readError(err: unknown, fallback: string) {
  return (err as ApiError)?.response?.data?.error ?? fallback
}

function initialsFor(name: string) {
  const parts = name.split(/[._\s-]+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return (name.slice(0, 2) || "GL").toUpperCase()
}

function formatSyncedAt(iso: string | null) {
  if (!iso) return "Never"
  const d = new Date(iso)
  const date = d.toLocaleDateString("en-GB")
  const time = d.toLocaleTimeString("en-GB", { hour12: false })
  return `${date}, ${time}`
}

export default function IntegrationsPage() {
  const org = useActiveOrg()
  const [integrations, setIntegrations] = useState<GitlabIntegration[] | null>(
    null,
  )

  useEffect(() => {
    if (!org) return
    let cancelled = false
    gitlabApi
      .list(org.id)
      .then((list) => {
        if (!cancelled) setIntegrations(list ?? [])
      })
      .catch((err) => {
        if (cancelled) return
        console.error("Failed to load GitLab integrations", err)
        setIntegrations([])
        toast.error(readError(err, "Failed to load GitLab integrations"))
      })
    return () => {
      cancelled = true
    }
  }, [org])

  // Surface ?gitlab_connected=true / ?gitlab_error=... after the OAuth round-trip.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const connected = params.get("gitlab_connected")
    const errMsg = params.get("gitlab_error")
    if (connected === "true") {
      toast.success("GitLab connected")
    } else if (errMsg) {
      toast.error(errMsg)
    }
    if (connected || errMsg) {
      params.delete("gitlab_connected")
      params.delete("gitlab_error")
      const search = params.toString()
      window.history.replaceState(
        {},
        "",
        window.location.pathname + (search ? `?${search}` : ""),
      )
    }
  }, [])

  const refresh = async () => {
    if (!org) return
    setIntegrations(await gitlabApi.list(org.id))
  }

  const startConnect = async () => {
    if (!org) return
    try {
      const url = await gitlabApi.startConnect(
        org.id,
        "/dashboard/settings/integrations",
      )
      window.location.href = url
    } catch (err) {
      toast.error(readError(err, "Failed to start GitLab connection"))
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">Integrations</h1>
      </div>

      <div className="bg-card/40 ring-border/40 flex flex-col gap-6 p-6 ring-1">
        <div className="flex items-center gap-3">
          <GitlabIcon className="size-8 shrink-0" />
          <div>
            <h2 className="text-base font-semibold">GitLab</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Connect your GitLab account. Connections are personal — each user
              in the organisation manages their own. You'll pick the
              repository, branch, and subfolder when creating a project.
            </p>
          </div>
        </div>

        {integrations === null ? (
          <Skeleton className="h-32 w-full" />
        ) : integrations.length === 0 ? (
          <div className="ring-border/40 flex flex-col items-center gap-3 py-10 text-center ring-1">
            <p className="text-muted-foreground text-sm">
              You haven't connected a GitLab account yet.
            </p>
            <Button onClick={startConnect} disabled={!org}>
              <GitlabIcon className="size-4" />
              Connect GitLab
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {integrations.map((it) => (
              <IntegrationCard
                key={it.id}
                orgId={org!.id}
                integration={it}
                onChanged={refresh}
              />
            ))}
          </div>
        )}

        {/* {integrations && integrations.length > 0 ? (
          <div>
            <Button variant="secondary" onClick={startConnect} disabled={!org}>
              <LinkIcon className="size-4" />
              Connect another account
            </Button>
          </div>
        ) : null} */}
      </div>

      {/* ── YouTrack ────────────────────────────────────────────────── */}
      {org && <YouTrackSection orgId={org.id} />}

      {/* ── Slack ───────────────────────────────────────────────────── */}
      {org && <SlackSection orgId={org.id} />}
    </div>
  )
}

// ── YouTrack Section ──────────────────────────────────────────────────────────

function YouTrackSection({ orgId }: { orgId: string }) {
  const [integration, setIntegration] = useState<YouTrackIntegration | null | undefined>(undefined)
  const [baseUrl, setBaseUrl] = useState("")
  const [token, setToken] = useState("")
  const [projectId, setProjectId] = useState("")
  const [boardId, setBoardId] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    youtrackApi.getStatus(orgId).then((res) => {
      if (cancelled) return
      setIntegration(res.connected && res.integration ? res.integration : null)
    }).catch(() => { if (!cancelled) setIntegration(null) })
    return () => { cancelled = true }
  }, [orgId])

  const handleConnect = async () => {
    if (!baseUrl.trim() || !token.trim() || !projectId.trim()) {
      toast.error("Base URL, token and project ID are required")
      return
    }
    setSaving(true)
    try {
      const result = await youtrackApi.connect(orgId, {
        base_url: baseUrl.trim(),
        token: token.trim(),
        project_id: projectId.trim(),
        board_id: boardId.trim() || undefined,
      })
      setIntegration(result)
      setToken("")
      toast.success("YouTrack connected")
    } catch (err) {
      toast.error(readError(err, "YouTrack connection failed"))
    } finally {
      setSaving(false)
    }
  }

  const handleDisconnect = async () => {
    if (!integration) return
    try {
      await youtrackApi.disconnect(orgId, integration.id)
      setIntegration(null)
      toast.success("YouTrack disconnected")
    } catch (err) {
      toast.error(readError(err, "Failed to disconnect"))
    }
  }

  return (
    <div className="bg-card/40 ring-border/40 flex flex-col gap-6 p-6 ring-1">
      <div className="flex items-center gap-3">
        <YoutrackIcon className="size-8 shrink-0" />
        <div>
          <h2 className="text-base font-semibold">YouTrack</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Connect your YouTrack instance to map sprint tickets to test specs and run
            coverage checks directly from the Sprints page. Uses a permanent token — no
            OAuth required.
          </p>
        </div>
      </div>

      {integration === undefined && <Skeleton className="h-20 w-full" />}

      {integration !== undefined && integration !== null && (
        <div className="ring-border/40 flex items-center justify-between gap-4 p-5 ring-1">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2Icon className="size-4 text-emerald-400" />
              <span className="font-semibold">{integration.base_url}</span>
            </div>
            <p className="text-muted-foreground text-xs">
              Project{" "}
              <span className="font-mono">{integration.project_id}</span>
              {integration.board_id && (
                <>
                  {" "}· Board{" "}
                  <span className="font-mono">{integration.board_id}</span>
                </>
              )}
            </p>
          </div>
          <Button variant="destructive" size="sm" onClick={() => void handleDisconnect()}>
            <Trash2Icon className="size-4" />
            Disconnect
          </Button>
        </div>
      )}

      {integration === null && (
        <div className="ring-border/40 flex flex-col gap-4 p-5 ring-1">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2 space-y-1">
              <Label htmlFor="yt-url-settings">Instance URL</Label>
              <Input
                id="yt-url-settings"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://youtrack.example.com"
              />
            </div>
            <div className="sm:col-span-2 space-y-1">
              <Label htmlFor="yt-token-settings">Permanent Token</Label>
              <Input
                id="yt-token-settings"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="perm:..."
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="yt-project-settings">Project ID</Label>
              <Input
                id="yt-project-settings"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                placeholder="ARD"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="yt-board-settings">
                Board ID{" "}
                <span className="text-muted-foreground text-xs">(optional)</span>
              </Label>
              <Input
                id="yt-board-settings"
                value={boardId}
                onChange={(e) => setBoardId(e.target.value)}
                placeholder="0-1"
              />
            </div>
          </div>
          <Button onClick={() => void handleConnect()} disabled={saving} className="self-start">
            {saving && <Loader2Icon className="size-4 animate-spin" />}
            Connect YouTrack
          </Button>
        </div>
      )}
    </div>
  )
}

// ── Slack Section ─────────────────────────────────────────────────────────────

function SlackSection({ orgId }: { orgId: string }) {
  const [settings, setSettings] = useState<SlackSettings | null | undefined>(undefined)
  const [webhookUrl, setWebhookUrl] = useState("")
  const [notifyOnFailure, setNotifyOnFailure] = useState(true)
  const [notifyOnSuccess, setNotifyOnSuccess] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    slackApi
      .getSettings(orgId)
      .then((res) => {
        if (cancelled) return
        setSettings(res)
        setWebhookUrl(res.webhook_url)
        setNotifyOnFailure(res.notify_on_failure)
        setNotifyOnSuccess(res.notify_on_success)
      })
      .catch(() => {
        if (!cancelled) setSettings(null)
      })
    return () => {
      cancelled = true
    }
  }, [orgId])

  const handleSave = async () => {
    setSaving(true)
    try {
      await slackApi.updateSettings(orgId, {
        webhook_url: webhookUrl.trim(),
        notify_on_failure: notifyOnFailure,
        notify_on_success: notifyOnSuccess,
      })
      toast.success("Slack settings saved")
    } catch (err) {
      toast.error(readError(err, "Failed to save Slack settings"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-card/40 ring-border/40 flex flex-col gap-6 p-6 ring-1">
      <div className="flex items-center gap-3">
        <SlackIcon className="size-8 shrink-0" />
        <div>
          <h2 className="text-base font-semibold">Slack</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Send run completion notifications to a Slack channel. Paste an
            Incoming Webhook URL from your Slack App configuration.
          </p>
        </div>
      </div>

      {settings === undefined && <Skeleton className="h-20 w-full" />}

      {settings !== undefined && (
        <div className="ring-border/40 flex flex-col gap-4 p-5 ring-1">
          <div className="space-y-1">
            <Label htmlFor="slack-webhook-url">Webhook URL</Label>
            <Input
              id="slack-webhook-url"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://hooks.slack.com/services/..."
            />
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id="slack-notify-failure"
                checked={notifyOnFailure}
                onCheckedChange={(checked) =>
                  setNotifyOnFailure(checked === true)
                }
              />
              <Label htmlFor="slack-notify-failure" className="cursor-pointer font-normal">
                Notify on failure
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="slack-notify-success"
                checked={notifyOnSuccess}
                onCheckedChange={(checked) =>
                  setNotifyOnSuccess(checked === true)
                }
              />
              <Label htmlFor="slack-notify-success" className="cursor-pointer font-normal">
                Notify on success
              </Label>
            </div>
          </div>

          <Button
            onClick={() => void handleSave()}
            disabled={saving}
            className="self-start"
          >
            {saving && <Loader2Icon className="size-4 animate-spin" />}
            Save
          </Button>
        </div>
      )}
    </div>
  )
}

// ── GitLab IntegrationCard ────────────────────────────────────────────────────

function IntegrationCard({
  orgId,
  integration,
  onChanged,
}: {
  orgId: string
  integration: GitlabIntegration
  onChanged: () => Promise<void> | void
}) {
  const [disconnecting, setDisconnecting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const handleDisconnect = async () => {
    setDisconnecting(true)
    try {
      await gitlabApi.disconnect(orgId, integration.id)
      toast.success("Disconnected")
      await onChanged()
    } catch (err) {
      toast.error(readError(err, "Failed to disconnect"))
    } finally {
      setDisconnecting(false)
      setConfirmOpen(false)
    }
  }

  return (
    <div className="ring-border/40 flex items-center justify-between gap-4 p-5 ring-1">
      <div className="flex items-center gap-3">
        <Avatar className="size-9 [&>img]:rounded-full">
          {integration.gitlab_avatar ? (
            <AvatarImage
              src={integration.gitlab_avatar}
              alt={integration.gitlab_username}
            />
          ) : null}
          <AvatarFallback>
            {initialsFor(integration.gitlab_username || "GL")}
          </AvatarFallback>
        </Avatar>
        <div>
          <div className="flex items-center gap-2 text-sm">
            <span className="font-semibold">
              {integration.gitlab_username || "GitLab account"}
            </span>
            <span className="text-muted-foreground text-xs">
              via GitLab OAuth
            </span>
          </div>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Last synced {formatSyncedAt(integration.last_synced_at)}
          </p>
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogTrigger asChild>
          <Button variant="destructive" disabled={disconnecting}>
            {disconnecting ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <Trash2Icon className="size-4" />
            )}
            Disconnect
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect GitLab account?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove{" "}
              <span className="font-medium">
                {integration.gitlab_username || "this GitLab account"}
              </span>{" "}
              from your account. Projects pointing at this repository will be
              syncable again once you (or another org member) reconnect.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnecting}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                void handleDisconnect()
              }}
              disabled={disconnecting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {disconnecting ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : null}
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
