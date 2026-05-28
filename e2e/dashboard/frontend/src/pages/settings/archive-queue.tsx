import { useEffect, useState } from "react"
import {
  ArchiveIcon,
  CheckCircle2Icon,
  Loader2Icon,
  SearchIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { useActiveOrg } from "@/lib/auth"
import {
  archiveApi,
  type ArchiveRequest,
} from "@/lib/scout-api"

type ApiError = { response?: { data?: { error?: string } } }

function readError(err: unknown, fallback: string) {
  return (err as ApiError)?.response?.data?.error ?? fallback
}

function relativeTime(iso: string) {
  const then = new Date(iso).getTime()
  const seconds = Math.max(1, Math.round((Date.now() - then) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60)
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? "" : "s"} ago`
}

type Toast = { kind: "success" | "error"; text: string }

export default function ArchiveQueuePage() {
  const org = useActiveOrg()
  const [requests, setRequests] = useState<ArchiveRequest[] | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)

  useEffect(() => {
    if (!org) return
    archiveApi
      .list(org.id)
      .then(setRequests)
      .catch(() => setRequests([]))
  }, [org])

  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 3500)
    return () => window.clearTimeout(id)
  }, [toast])

  const refresh = async () => {
    if (!org) return
    setRequests(await archiveApi.list(org.id))
  }

  const pending =
    requests?.filter((r) => r.status === "pending") ?? null

  const handleApprove = async (r: ArchiveRequest) => {
    if (!org) return
    const ok = window.confirm(
      `Permanently delete "${r.test_case_name}"? This cannot be undone.`,
    )
    if (!ok) return
    setBusyId(r.id)
    try {
      await archiveApi.approve(org.id, r.id)
      setToast({ kind: "success", text: `Deleted "${r.test_case_name}"` })
      await refresh()
    } catch (err) {
      setToast({ kind: "error", text: readError(err, "Failed to approve") })
    } finally {
      setBusyId(null)
    }
  }

  const handleReject = async (r: ArchiveRequest, comment: string) => {
    if (!org) return
    setBusyId(r.id)
    try {
      await archiveApi.reject(org.id, r.id, comment)
      setToast({ kind: "success", text: "Request rejected" })
      setRejectingId(null)
      await refresh()
    } catch (err) {
      setToast({ kind: "error", text: readError(err, "Failed to reject") })
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">Archive Queue</h1>
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

      <p className="text-muted-foreground text-sm">
        Test cases submitted for deletion require admin approval. Approved
        requests are permanently deleted.
      </p>

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

      {requests === null ? (
        <div className="grid gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : !pending || pending.length === 0 ? (
        <div className="ring-border/40 flex flex-col items-center justify-center gap-3 py-20 text-center ring-1">
          <ArchiveIcon
            className="text-muted-foreground size-10"
            strokeWidth={1.5}
          />
          <div>
            <h2 className="text-base font-semibold">No pending requests</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Archive requests will appear here for review
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {pending.map((r) => (
            <RequestCard
              key={r.id}
              request={r}
              busy={busyId === r.id}
              isRejecting={rejectingId === r.id}
              onApprove={() => handleApprove(r)}
              onStartReject={() => setRejectingId(r.id)}
              onCancelReject={() => setRejectingId(null)}
              onConfirmReject={(comment) => handleReject(r, comment)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function RequestCard({
  request,
  busy,
  isRejecting,
  onApprove,
  onStartReject,
  onCancelReject,
  onConfirmReject,
}: {
  request: ArchiveRequest
  busy: boolean
  isRejecting: boolean
  onApprove: () => void
  onStartReject: () => void
  onCancelReject: () => void
  onConfirmReject: (comment: string) => void
}) {
  const [comment, setComment] = useState("")

  return (
    <div className="bg-card/40 ring-border/40 flex flex-col gap-3 p-5 ring-1">
      <div>
        <h3 className="text-base font-semibold">{request.test_case_name}</h3>
        <p className="text-muted-foreground mt-1 text-xs">
          Requested by {request.requester_name || "Unknown"} ·{" "}
          {relativeTime(request.created_at)}
        </p>
      </div>

      {request.reason ? (
        <blockquote className="bg-muted/30 ring-border/40 text-muted-foreground italic px-3 py-2 text-sm ring-1">
          “{request.reason}”
        </blockquote>
      ) : null}

      {isRejecting ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            onConfirmReject(comment.trim())
          }}
          className="flex flex-col gap-2"
        >
          <Input
            autoFocus
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Reason for rejection (optional)"
            className="bg-muted/40"
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setComment("")
                onCancelReject()
              }}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={busy}
            >
              {busy ? <Loader2Icon className="size-4 animate-spin" /> : null}
              Confirm Reject
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onStartReject}
            disabled={busy}
            className="ring-rose-500/40 text-rose-300 hover:bg-rose-500/10 inline-flex items-center gap-2 px-4 py-2 text-sm ring-1 disabled:opacity-50"
          >
            <XIcon className="size-4" />
            Reject
          </button>
          <button
            type="button"
            onClick={onApprove}
            disabled={busy}
            className="bg-rose-500/80 hover:bg-rose-500 text-white inline-flex items-center gap-2 px-4 py-2 text-sm disabled:opacity-50"
          >
            {busy ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <Trash2Icon className="size-4" />
            )}
            Approve &amp; Delete
          </button>
        </div>
      )}
    </div>
  )
}
