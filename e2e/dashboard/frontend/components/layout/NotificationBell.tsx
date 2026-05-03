'use client'

import { useState, useEffect, useRef } from 'react'
import { Bell, CheckCheck, AlertCircle, PlayCircle, PackageSearch } from 'lucide-react'
import { notificationsApi } from '@/lib/api'
import { formatDistanceToNow } from 'date-fns'
import s from './NotificationBell.module.css'

interface Notification {
  id: string
  type: string
  title: string
  message: string
  read: boolean
  created_at: string
  run_id?: string
}

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  useEffect(() => {
    if (!open) return
    setLoading(true)
    notificationsApi.list({ limit: 20 })
      .then((res) => {
        setNotifications(res.data.notifications ?? [])
        setUnread(res.data.unread_count ?? 0)
      })
      .finally(() => setLoading(false))
  }, [open])

  useEffect(() => {
    const poll = () => {
      notificationsApi.list({ limit: 1 })
        .then((res) => setUnread(res.data.unread_count ?? 0))
        .catch(() => {})
    }
    poll()
    const id = setInterval(poll, 30_000)
    return () => clearInterval(id)
  }, [])

  const markAllRead = async () => {
    await notificationsApi.readAll()
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
    setUnread(0)
  }

  const markRead = async (id: string) => {
    await notificationsApi.read(id)
    setNotifications((prev) => prev.map((n) => n.id === id ? { ...n, read: true } : n))
    setUnread((u) => Math.max(0, u - 1))
  }

  return (
    <div ref={ref} className={s.wrap}>
      <button
        onClick={() => setOpen(!open)}
        className={s.trigger}
        aria-label="Notifications"
      >
        <Bell size={16} />
        {unread > 0 && (
          <span className={s.badge}>{unread > 9 ? '9+' : unread}</span>
        )}
      </button>

      {open && (
        <div className={s.panel}>
          <div className={s.panelHeader}>
            <span className={s.panelTitle}>Notifications</span>
            {unread > 0 && (
              <button onClick={markAllRead} className={s.markAllBtn}>
                <CheckCheck size={12} />
                Mark all read
              </button>
            )}
          </div>

          <div className={s.list}>
            {loading && <div className={s.spinner} />}

            {!loading && notifications.length === 0 && (
              <div className={s.empty}>
                <Bell size={22} style={{ opacity: 0.3 }} />
                <span>No notifications yet</span>
              </div>
            )}

            {!loading && notifications.map((n) => (
              <button
                key={n.id}
                onClick={() => !n.read && markRead(n.id)}
                className={`${s.item} ${!n.read ? s.itemUnread : ''}`}
              >
                <NotifIcon type={n.type} s={s} />
                <div className={s.body}>
                  <p className={`${s.notifTitle} ${n.read ? s.notifTitleRead : ''}`}>
                    {n.title}
                  </p>
                  {n.message && <p className={s.notifMsg}>{n.message}</p>}
                  <p className={s.notifTime}>
                    {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                  </p>
                </div>
                {!n.read && <span className={s.unreadDot} />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function NotifIcon({ type, s }: { type: string; s: Record<string, string> }) {
  if (type.startsWith('run_failed') || type.startsWith('scorm_error')) {
    return <span className={`${s.notifIcon} ${s.iconFailed}`}><AlertCircle size={13} /></span>
  }
  if (type.startsWith('scorm')) {
    return <span className={`${s.notifIcon} ${s.iconScorm}`}><PackageSearch size={13} /></span>
  }
  return <span className={`${s.notifIcon} ${s.iconPassed}`}><PlayCircle size={13} /></span>
}
