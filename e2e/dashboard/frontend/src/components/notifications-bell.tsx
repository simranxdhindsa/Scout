import { useCallback, useEffect, useState } from "react"
import {
  AlertCircleIcon,
  BellIcon,
  CheckCheckIcon,
  Loader2Icon,
  PackageSearchIcon,
  PlayCircleIcon,
} from "lucide-react"
import { useNavigate } from "react-router-dom"

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  notificationsApi,
  type Notification,
} from "@/lib/scout-api"

function relativeTime(iso: string) {
  const then = new Date(iso).getTime()
  const seconds = Math.max(1, Math.round((Date.now() - then) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? "" : "s"} ago`
}

function iconFor(type: string) {
  if (type.startsWith("run_failed") || type.startsWith("scorm_error"))
    return <AlertCircleIcon className="size-4 text-rose-400" />
  if (type.startsWith("scorm"))
    return <PackageSearchIcon className="size-4 text-violet-400" />
  return <PlayCircleIcon className="size-4 text-emerald-400" />
}

function formatBadge(count: number) {
  if (count <= 0) return null
  if (count > 9) return "9+"
  return String(count)
}

export function NotificationsBell() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Notification[] | null>(null)
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(false)
  const [markingAll, setMarkingAll] = useState(false)

  // Cheap background poll for the unread count only.
  useEffect(() => {
    let cancelled = false

    const fetchCount = async () => {
      try {
        const data = await notificationsApi.list({ limit: 1 })
        if (!cancelled) setUnread(data.unread_count)
      } catch {
        // ignore poll failures
      }
    }

    fetchCount()
    const interval = window.setInterval(fetchCount, 30_000)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [])

  // Load full list when the panel opens.
  const loadFull = useCallback(async () => {
    setLoading(true)
    try {
      const data = await notificationsApi.list({ limit: 20 })
      setItems(data.notifications)
      setUnread(data.unread_count)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) loadFull()
  }, [open, loadFull])

  const markRead = async (n: Notification) => {
    if (n.read) return
    // Optimistic update
    setItems((prev) =>
      prev ? prev.map((i) => (i.id === n.id ? { ...i, read: true } : i)) : prev,
    )
    setUnread((c) => Math.max(0, c - 1))
    try {
      await notificationsApi.read(n.id)
    } catch {
      // best-effort
    }
  }

  const handleItemClick = async (n: Notification) => {
    await markRead(n)
    if (n.run_id) {
      setOpen(false)
      navigate(`/runs/${n.run_id}`)
    }
  }

  const markAll = async () => {
    setMarkingAll(true)
    setItems((prev) => (prev ? prev.map((i) => ({ ...i, read: true })) : prev))
    setUnread(0)
    try {
      await notificationsApi.readAll()
    } catch {
      // best-effort
    } finally {
      setMarkingAll(false)
    }
  }

  const badge = formatBadge(unread)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="bg-muted/60 ring-border/40 hover:bg-accent relative inline-flex size-9 items-center justify-center ring-1"
          aria-label="Notifications"
        >
          <BellIcon className="size-4" />
          {badge ? (
            <span className="bg-primary text-primary-foreground absolute -top-1 -right-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px]">
              {badge}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-80 p-0">
        <div className="border-border/60 flex items-center justify-between border-b px-4 py-3">
          <h3 className="text-sm font-semibold">Notifications</h3>
          {unread > 0 ? (
            <button
              type="button"
              onClick={markAll}
              disabled={markingAll}
              className="text-primary hover:text-primary/80 inline-flex items-center gap-1 text-xs disabled:opacity-50"
            >
              {markingAll ? (
                <Loader2Icon className="size-3 animate-spin" />
              ) : (
                <CheckCheckIcon className="size-3" />
              )}
              Mark all read
            </button>
          ) : null}
        </div>

        <div className="max-h-96 overflow-y-auto">
          {items === null || loading ? (
            <div className="text-muted-foreground flex items-center justify-center gap-2 py-8 text-sm">
              <Loader2Icon className="size-4 animate-spin" /> Loading…
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
              <BellIcon
                className="text-muted-foreground/30 size-8"
                strokeWidth={1.5}
              />
              <p className="text-muted-foreground text-sm">
                No notifications yet
              </p>
            </div>
          ) : (
            <ul>
              {items.map((n) => (
                <li
                  key={n.id}
                  className={`border-border/40 not-last:border-b cursor-pointer px-4 py-3 transition ${
                    n.read ? "bg-transparent" : "bg-primary/5"
                  } hover:bg-muted/30`}
                  onClick={() => handleItemClick(n)}
                >
                  <div className="flex items-start gap-3">
                    <span className="bg-muted/60 ring-border/40 mt-0.5 inline-flex size-7 shrink-0 items-center justify-center ring-1">
                      {iconFor(n.type)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div
                        className={`text-sm ${
                          n.read
                            ? "text-muted-foreground"
                            : "font-semibold"
                        }`}
                      >
                        {n.title}
                      </div>
                      {n.message ? (
                        <div className="text-muted-foreground mt-0.5 text-xs">
                          {n.message}
                        </div>
                      ) : null}
                      <div className="text-muted-foreground mt-1 text-[10px]">
                        {relativeTime(n.created_at)}
                      </div>
                    </div>
                    {!n.read ? (
                      <span
                        className="bg-primary mt-1.5 inline-block size-2 shrink-0 rounded-full"
                        aria-label="unread"
                      />
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
