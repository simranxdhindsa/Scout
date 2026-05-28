import { useEffect, useState } from "react"
import {
  CheckCircle2Icon,
  Loader2Icon,
  SearchIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"

import GitlabIcon from "@/assets/GitlabIcon"
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
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { useActiveOrg } from "@/lib/auth"
import { gitlabApi, type GitlabIntegration } from "@/lib/scout-api"

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

type Toast = { kind: "success" | "error"; text: string }

export default function IntegrationsPage() {
  const org = useActiveOrg()
  const [integrations, setIntegrations] = useState<GitlabIntegration[] | null>(
    null,
  )
  const [toast, setToast] = useState<Toast | null>(null)

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
        setToast({
          kind: "error",
          text: readError(err, "Failed to load GitLab integrations"),
        })
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
      setToast({ kind: "success", text: "GitLab connected" })
    } else if (errMsg) {
      setToast({ kind: "error", text: errMsg })
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

  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 3500)
    return () => window.clearTimeout(id)
  }, [toast])

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
      setToast({
        kind: "error",
        text: readError(err, "Failed to start GitLab connection"),
      })
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">Integrations</h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <SearchIcon className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              placeholder="Search..."
              className="bg-muted/60 w-64 pl-9 pr-12"
            />
            <kbd className="bg-muted text-muted-foreground absolute top-1/2 right-2 -translate-y-1/2 px-1.5 py-0.5 text-[10px]">
              ⌘K
            </kbd>
          </div>
        </div>
      </div>

      {toast ? (
        <div
          className={`flex items-center gap-2 px-4 py-2 text-sm ring-1 ${
            toast.kind === "success"
              ? "bg-emerald-500/10 text-emerald-200 ring-emerald-500/30"
              : "bg-rose-500/10 text-rose-200 ring-rose-500/30"
          }`}
        >
          {toast.kind === "success" ? (
            <CheckCircle2Icon className="size-4" />
          ) : (
            <XIcon className="size-4" />
          )}
          {toast.text}
        </div>
      ) : null}

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
                onToast={setToast}
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
    </div>
  )
}

function IntegrationCard({
  orgId,
  integration,
  onChanged,
  onToast,
}: {
  orgId: string
  integration: GitlabIntegration
  onChanged: () => Promise<void> | void
  onToast: (t: Toast) => void
}) {
  const [disconnecting, setDisconnecting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const handleDisconnect = async () => {
    setDisconnecting(true)
    try {
      await gitlabApi.disconnect(orgId, integration.id)
      onToast({ kind: "success", text: "Disconnected" })
      await onChanged()
    } catch (err) {
      onToast({ kind: "error", text: readError(err, "Failed to disconnect") })
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
