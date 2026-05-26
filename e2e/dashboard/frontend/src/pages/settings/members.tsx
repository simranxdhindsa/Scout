import { useEffect, useState } from "react"
import {
  ChevronDownIcon,
  Loader2Icon,
  PlusIcon,
  SearchIcon,
  ShieldIcon,
  Trash2Icon,
  UserIcon,
  XIcon,
} from "lucide-react"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuthStore } from "@/lib/auth"
import {
  membersApi,
  type MemberRole,
  type OrgMember,
} from "@/lib/scout-api"

type ApiError = { response?: { data?: { error?: string } } }

function readError(err: unknown, fallback: string) {
  return (err as ApiError)?.response?.data?.error ?? fallback
}

function initialsFor(name: string, email: string) {
  const base = name?.trim() || email
  const parts = base.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return base.slice(0, 1).toUpperCase()
}

export default function MembersPage() {
  const org = useAuthStore((s) => s.orgs[0] ?? null)
  const currentUserId = useAuthStore((s) => s.user?.id ?? null)
  const [members, setMembers] = useState<OrgMember[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    if (!org) return
    membersApi
      .list(org.id)
      .then(setMembers)
      .catch(() => setMembers([]))
  }, [org])

  const refresh = async () => {
    if (!org) return
    setMembers(await membersApi.list(org.id))
  }

  const handleRoleChange = async (m: OrgMember, role: MemberRole) => {
    if (!org || role === m.role) return
    setBusyId(m.id)
    setError(null)
    try {
      await membersApi.update(org.id, m.id, { role })
      await refresh()
    } catch (err) {
      setError(readError(err, "Failed to update role"))
    } finally {
      setBusyId(null)
    }
  }

  const handleRemove = async (m: OrgMember) => {
    if (!org) return
    if (!confirm(`Remove ${m.user_name || m.user_email} from the org?`)) return
    setBusyId(m.id)
    setError(null)
    try {
      await membersApi.remove(org.id, m.id)
      await refresh()
    } catch (err) {
      setError(readError(err, "Failed to remove member"))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">Members</h1>
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

      <div className="bg-card/40 ring-border/40 flex flex-col gap-4 p-6 ring-1">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Team Members</h2>
          <Button
            onClick={() => {
              setAdding(true)
              setError(null)
            }}
            disabled={!org || adding}
          >
            <PlusIcon className="size-4" />
            Add Member
          </Button>
        </div>

        {error ? <p className="text-destructive text-sm">{error}</p> : null}

        {adding && org ? (
          <AddMemberForm
            orgId={org.id}
            onCancel={() => setAdding(false)}
            onAdded={async () => {
              setAdding(false)
              await refresh()
            }}
            onError={setError}
          />
        ) : null}

        <ul className="divide-border/40 -mx-2 divide-y">
          {members === null ? (
            Array.from({ length: 3 }).map((_, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-4 px-2 py-4"
              >
                <div className="flex items-center gap-3">
                  <Skeleton className="size-10 rounded-full" />
                  <div className="flex flex-col gap-1.5">
                    <Skeleton className="h-3.5 w-32" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                </div>
                <Skeleton className="h-9 w-44" />
              </li>
            ))
          ) : members.length === 0 ? (
            <li className="text-muted-foreground px-2 py-6 text-center text-sm">
              No members yet
            </li>
          ) : (
            members.map((m) => {
              const isMe = m.user_id === currentUserId
              const busy = busyId === m.id
              return (
                <li
                  key={m.id}
                  className="flex items-center justify-between gap-4 px-2 py-4"
                >
                  <div className="flex items-center gap-3">
                    <Avatar className="size-10">
                      {m.avatar_url ? (
                        <AvatarImage src={m.avatar_url} alt={m.user_name} />
                      ) : null}
                      <AvatarFallback>
                        {initialsFor(m.user_name, m.user_email)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        {m.user_name || m.user_email}
                        {isMe ? (
                          <span className="text-muted-foreground text-xs font-normal">
                            (you)
                          </span>
                        ) : null}
                      </div>
                      <div className="text-muted-foreground text-xs">
                        {m.user_email}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="bg-muted/60 ring-border/40 relative ring-1">
                      <select
                        value={m.role}
                        disabled={isMe || busy}
                        onChange={(e) =>
                          handleRoleChange(m, e.target.value as MemberRole)
                        }
                        className="appearance-none bg-transparent py-2 pr-8 pl-3 text-sm capitalize outline-none disabled:opacity-50"
                      >
                        <option value="admin">Admin</option>
                        <option value="member">Member</option>
                      </select>
                      <ChevronDownIcon className="text-muted-foreground pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2" />
                    </div>
                    <span
                      className="bg-muted/60 ring-border/40 inline-flex size-9 items-center justify-center ring-1"
                      aria-label={m.role === "admin" ? "Admin" : "Member"}
                      title={m.role === "admin" ? "Admin" : "Member"}
                    >
                      {m.role === "admin" ? (
                        <ShieldIcon className="text-primary size-4" />
                      ) : (
                        <UserIcon className="text-muted-foreground size-4" />
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemove(m)}
                      disabled={isMe || busy}
                      aria-label="Remove"
                      className="bg-destructive/80 hover:bg-destructive ring-destructive/40 text-destructive-foreground inline-flex size-9 items-center justify-center ring-1 disabled:opacity-40"
                    >
                      {busy ? (
                        <Loader2Icon className="size-4 animate-spin" />
                      ) : (
                        <Trash2Icon className="size-4" />
                      )}
                    </button>
                  </div>
                </li>
              )
            })
          )}
        </ul>
      </div>
    </div>
  )
}

function AddMemberForm({
  orgId,
  onCancel,
  onAdded,
  onError,
}: {
  orgId: string
  onCancel: () => void
  onAdded: () => void
  onError: (msg: string) => void
}) {
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<MemberRole>("member")
  const [saving, setSaving] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    setSaving(true)
    try {
      await membersApi.add(orgId, { email: email.trim(), role })
      onAdded()
    } catch (err) {
      onError(readError(err, "Failed to add member"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={submit}
      className="bg-muted/30 ring-border/40 flex flex-col gap-3 p-4 ring-1"
    >
      <div className="grid gap-3 md:grid-cols-[1fr_160px_auto]">
        <Input
          type="email"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="user@company.com"
          required
          className="bg-muted/40"
        />
        <div className="bg-muted/40 ring-border/40 relative ring-1">
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as MemberRole)}
            className="w-full appearance-none bg-transparent py-2 pr-8 pl-3 text-sm outline-none"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <ChevronDownIcon className="text-muted-foreground pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2" />
        </div>
        <div className="flex items-center gap-2">
          <Button type="submit" disabled={!email.trim() || saving}>
            {saving ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <PlusIcon className="size-4" />
            )}
            Add
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            <XIcon className="size-4" />
            Cancel
          </Button>
        </div>
      </div>
      <p className="text-muted-foreground text-xs">
        The user must have signed in with Google at least once.
      </p>
    </form>
  )
}
