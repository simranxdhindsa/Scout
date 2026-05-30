import { useEffect, useState } from "react"
import {
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react"

import { EnvironmentDialog } from "@/components/dialogs/environment-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { useActiveOrg } from "@/lib/auth"
import { environmentsApi, type Environment } from "@/lib/scout-api"

function chipClassFor(name: string) {
  const n = name.toLowerCase()
  if (n.startsWith("prod"))
    return "bg-rose-500/10 text-rose-300 ring-rose-500/30"
  if (n.startsWith("stage"))
    return "bg-amber-500/10 text-amber-300 ring-amber-500/30"
  return "bg-sky-500/10 text-sky-300 ring-sky-500/30"
}

type ApiError = { response?: { data?: { error?: string } } }

function readError(err: unknown, fallback: string) {
  return (err as ApiError)?.response?.data?.error ?? fallback
}

export default function EnvironmentsPage() {
  const org = useActiveOrg()
  const [envs, setEnvs] = useState<Environment[] | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingEnv, setEditingEnv] = useState<Environment | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    if (!org) return
    environmentsApi
      .list(org.id)
      .then(setEnvs)
      .catch(() => setEnvs([]))
  }, [org])

  const refresh = async () => {
    if (!org) return
    setEnvs(await environmentsApi.list(org.id))
  }

  const handleDelete = async (env: Environment) => {
    if (!org) return
    if (!confirm(`Delete environment "${env.name}"?`)) return
    setBusyId(env.id)
    setError(null)
    try {
      await environmentsApi.remove(org.id, env.id)
      await refresh()
    } catch (err) {
      setError(readError(err, "Cannot delete environment with active runs"))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">Environments</h1>
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
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold">Manage Environments</h2>
            <p className="text-muted-foreground mt-2 text-sm">
              Environments define base URLs for each sub-project. Select an
              environment when starting a run.
            </p>
          </div>
          <Button
            onClick={() => {
              setDialogOpen(true)
              setError(null)
            }}
            disabled={!org}
          >
            <PlusIcon className="size-4" />
            Add Environment
          </Button>
        </div>

        {error ? <p className="text-destructive text-sm">{error}</p> : null}

        <div className="ring-border/40 flex flex-col ring-1">
          {envs === null ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="border-border/40 not-last:border-b flex items-center justify-between gap-4 px-4 py-4"
              >
                <div className="flex flex-col gap-1.5">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-48" />
                </div>
                <Skeleton className="h-8 w-20" />
              </div>
            ))
          ) : envs.length === 0 ? (
            <div className="text-muted-foreground flex min-h-32 items-center justify-center text-sm">
              No environments yet
            </div>
          ) : (
            envs.map((env) => (
              <div
                key={env.id}
                className="border-border/40 not-last:border-b flex items-center justify-between gap-4 px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`px-2 py-0.5 text-[10px] font-medium tracking-wider uppercase ring-1 ${chipClassFor(env.name)}`}
                  >
                    {env.name}
                  </span>
                  <div>
                    <div className="text-sm font-semibold">{env.name}</div>
                    {env.label ? (
                      <div className="text-muted-foreground text-xs">
                        {env.label}
                      </div>
                    ) : null}
                    {env.base_url ? (
                      <div className="text-muted-foreground font-mono text-xs">
                        {env.base_url}
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingEnv(env)
                      setError(null)
                    }}
                    className="bg-muted/60 ring-border/40 hover:bg-accent inline-flex size-8 items-center justify-center ring-1"
                    aria-label="Edit"
                  >
                    <PencilIcon className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(env)}
                    disabled={busyId === env.id}
                    className="bg-rose-500/10 ring-rose-500/30 hover:bg-rose-500/20 text-rose-300 inline-flex size-8 items-center justify-center ring-1 disabled:opacity-50"
                    aria-label="Delete"
                  >
                    {busyId === env.id ? (
                      <Loader2Icon className="size-3.5 animate-spin" />
                    ) : (
                      <Trash2Icon className="size-3.5" />
                    )}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <EnvironmentDialog
        orgId={org?.id ?? null}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSaved={refresh}
      />

      <EnvironmentDialog
        orgId={org?.id ?? null}
        env={editingEnv}
        open={editingEnv !== null}
        onOpenChange={(open) => {
          if (!open) setEditingEnv(null)
        }}
        onSaved={refresh}
      />
    </div>
  )
}
