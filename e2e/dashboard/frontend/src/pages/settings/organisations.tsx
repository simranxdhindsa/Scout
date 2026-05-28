import { useEffect, useMemo, useState } from "react"
import {
  ChevronDownIcon,
  ChevronRightIcon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  ShieldIcon,
  Trash2Icon,
  UserIcon,
  UsersIcon,
} from "lucide-react"

import { AddOrganisationDialog } from "@/components/dialogs/add-organisation-dialog"
import { EditOrganisationDialog } from "@/components/dialogs/edit-organisation-dialog"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuthStore } from "@/lib/auth"
import {
  adminOrgMembersApi,
  adminUsersApi,
  orgsApi,
  type MemberRole,
  type OrgMember,
  type ScoutOrg,
  type ScoutUser,
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

function OrgMembersPanel({ org }: { org: ScoutOrg }) {
  const [members, setMembers] = useState<OrgMember[] | null>(null)
  const [allUsers, setAllUsers] = useState<ScoutUser[]>([])
  const [addUserId, setAddUserId] = useState("")
  const [addRole, setAddRole] = useState<MemberRole>("member")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    try {
      setMembers(await adminOrgMembersApi.list(org.id))
    } catch (err) {
      setError(readError(err, "Failed to load members"))
      setMembers([])
    }
  }

  useEffect(() => {
    load()
    adminUsersApi
      .list()
      .then(setAllUsers)
      .catch(() => setAllUsers([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org.id])

  const assignableUsers = useMemo(() => {
    const memberIds = new Set((members ?? []).map((m) => m.user_id))
    return allUsers.filter((u) => !memberIds.has(u.id))
  }, [allUsers, members])

  const handleAdd = async () => {
    if (!addUserId) return
    setBusy(true)
    setError(null)
    try {
      await adminOrgMembersApi.add(org.id, { user_id: addUserId, role: addRole })
      setAddUserId("")
      setAddRole("member")
      await load()
    } catch (err) {
      setError(readError(err, "Failed to add member"))
    } finally {
      setBusy(false)
    }
  }

  const handleRoleChange = async (m: OrgMember, role: MemberRole) => {
    if (role === m.role) return
    setBusy(true)
    setError(null)
    try {
      await adminOrgMembersApi.add(org.id, { user_id: m.user_id, role })
      await load()
    } catch (err) {
      setError(readError(err, "Failed to update role"))
    } finally {
      setBusy(false)
    }
  }

  const handleRemove = async (m: OrgMember) => {
    if (!confirm(`Remove ${m.user_name || m.user_email} from ${org.name}?`)) return
    setBusy(true)
    setError(null)
    try {
      await adminOrgMembersApi.remove(org.id, m.user_id)
      await load()
    } catch (err) {
      setError(readError(err, "Failed to remove member"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-muted/20 border-border/40 flex flex-col gap-4 border-t px-4 py-4">
      {error ? <p className="text-destructive text-sm">{error}</p> : null}

      {/* Add member */}
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={addUserId}
          onValueChange={setAddUserId}
          disabled={busy || assignableUsers.length === 0}
        >
          <SelectTrigger className="bg-background w-64">
            <SelectValue
              placeholder={
                assignableUsers.length === 0
                  ? "All users are members"
                  : "Select user"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {assignableUsers.map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.name || u.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={addRole}
          onValueChange={(v) => setAddRole(v as MemberRole)}
          disabled={busy}
        >
          <SelectTrigger className="bg-background w-32 capitalize">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="member">Member</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={handleAdd} disabled={busy || !addUserId}>
          {busy ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <PlusIcon className="size-4" />
          )}
          Add Member
        </Button>
      </div>

      {/* Members list */}
      <ul className="divide-border/40 divide-y">
        {members === null ? (
          Array.from({ length: 2 }).map((_, i) => (
            <li key={i} className="py-3">
              <Skeleton className="h-9 w-full" />
            </li>
          ))
        ) : members.length === 0 ? (
          <li className="text-muted-foreground py-4 text-center text-sm">
            No members yet
          </li>
        ) : (
          members.map((m) => (
            <li
              key={m.id}
              className="flex items-center justify-between gap-4 py-3"
            >
              <div className="flex items-center gap-3">
                <Avatar className="size-9">
                  {m.avatar_url ? (
                    <AvatarImage src={m.avatar_url} alt={m.user_name} />
                  ) : null}
                  <AvatarFallback>
                    {initialsFor(m.user_name, m.user_email)}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <div className="text-sm font-semibold">
                    {m.user_name || m.user_email}
                  </div>
                  <div className="text-muted-foreground text-xs">
                    {m.user_email}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Select
                  value={m.role}
                  disabled={busy}
                  onValueChange={(v) => handleRoleChange(m, v as MemberRole)}
                >
                  <SelectTrigger className="bg-background w-32 capitalize">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="member">Member</SelectItem>
                  </SelectContent>
                </Select>
                <span
                  className="bg-background ring-border/40 inline-flex size-9 items-center justify-center ring-1"
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
                  disabled={busy}
                  aria-label="Remove"
                  className="bg-destructive/80 hover:bg-destructive ring-destructive/40 text-destructive-foreground inline-flex size-9 items-center justify-center ring-1 disabled:opacity-40"
                >
                  <Trash2Icon className="size-4" />
                </button>
              </div>
            </li>
          ))
        )}
      </ul>
    </div>
  )
}

export default function OrganisationsPage() {
  const storeOrgs = useAuthStore((s) => s.orgs)
  const loadMe = useAuthStore((s) => s.loadMe)
  const isPlatformAdmin = useAuthStore((s) => s.isPlatformAdmin)
  const [orgs, setOrgs] = useState<ScoutOrg[] | null>(
    storeOrgs.length > 0 ? storeOrgs : null,
  )
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editOrg, setEditOrg] = useState<ScoutOrg | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const refresh = async () => {
    try {
      setOrgs(await orgsApi.list({ includeInactive: true }))
    } catch {
      setOrgs(storeOrgs)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">Organisations</h1>
      </div>

      <div className="bg-card/40 ring-border/40 flex flex-col gap-4 p-6 ring-1">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold">Your Organisations</h2>
            <p className="text-muted-foreground mt-2 text-sm">
              Organisations group projects, members, environments, and runs.
            </p>
          </div>
          <Button onClick={() => setDialogOpen(true)}>
            <PlusIcon className="size-4" />
            Add Organisation
          </Button>
        </div>

        <div className="ring-border/40 flex flex-col ring-1">
          {orgs === null ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="border-border/40 not-last:border-b flex items-center justify-between gap-4 px-4 py-4"
              >
                <div className="flex flex-col gap-1.5">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-48" />
                </div>
                <Skeleton className="h-5 w-16" />
              </div>
            ))
          ) : orgs.length === 0 ? (
            <div className="text-muted-foreground flex min-h-32 items-center justify-center text-sm">
              No organisations yet
            </div>
          ) : (
            orgs.map((org) => {
              const expanded = expandedId === org.id
              return (
                <div
                  key={org.id}
                  className="border-border/40 not-last:border-b flex flex-col"
                >
                  <div className="flex items-center justify-between gap-4 px-4 py-3">
                    <div className="flex flex-col">
                      <div className="text-sm font-semibold">{org.name}</div>
                      <div className="text-muted-foreground font-mono text-xs">
                        {org.slug}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span
                        className={`px-2 py-0.5 text-[10px] font-medium tracking-wider uppercase ring-1 ${
                          org.is_active
                            ? "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30"
                            : "bg-muted text-muted-foreground ring-border/40"
                        }`}
                      >
                        {org.is_active ? "Active" : "Inactive"}
                      </span>
                      {isPlatformAdmin ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setExpandedId(expanded ? null : org.id)
                          }
                          aria-label={`Manage members of ${org.name}`}
                        >
                          {expanded ? (
                            <ChevronDownIcon className="size-4" />
                          ) : (
                            <ChevronRightIcon className="size-4" />
                          )}
                          <UsersIcon className="size-4" />
                          Members
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setEditOrg(org)}
                        aria-label={`Edit ${org.name}`}
                      >
                        <PencilIcon className="size-4" />
                      </Button>
                    </div>
                  </div>
                  {isPlatformAdmin && expanded ? (
                    <OrgMembersPanel org={org} />
                  ) : null}
                </div>
              )
            })
          )}
        </div>
      </div>

      <AddOrganisationDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={async () => {
          await refresh()
          await loadMe()
        }}
      />

      <EditOrganisationDialog
        org={editOrg}
        open={editOrg !== null}
        onOpenChange={(open) => {
          if (!open) setEditOrg(null)
        }}
        onSaved={async () => {
          await refresh()
          await loadMe()
        }}
      />
    </div>
  )
}
