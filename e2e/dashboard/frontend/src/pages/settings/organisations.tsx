import { useEffect, useState } from "react"
import { PlusIcon } from "lucide-react"

import { AddOrganisationDialog } from "@/components/dialogs/add-organisation-dialog"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuthStore } from "@/lib/auth"
import { orgsApi, type ScoutOrg } from "@/lib/scout-api"

export default function OrganisationsPage() {
  const storeOrgs = useAuthStore((s) => s.orgs)
  const loadMe = useAuthStore((s) => s.loadMe)
  const [orgs, setOrgs] = useState<ScoutOrg[] | null>(
    storeOrgs.length > 0 ? storeOrgs : null,
  )
  const [dialogOpen, setDialogOpen] = useState(false)

  const refresh = async () => {
    try {
      setOrgs(await orgsApi.list())
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
            orgs.map((org) => (
              <div
                key={org.id}
                className="border-border/40 not-last:border-b flex items-center justify-between gap-4 px-4 py-3"
              >
                <div className="flex flex-col">
                  <div className="text-sm font-semibold">{org.name}</div>
                  <div className="text-muted-foreground font-mono text-xs">
                    {org.slug}
                  </div>
                </div>
                <span
                  className={`px-2 py-0.5 text-[10px] font-medium tracking-wider uppercase ring-1 ${
                    org.is_active
                      ? "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30"
                      : "bg-muted text-muted-foreground ring-border/40"
                  }`}
                >
                  {org.is_active ? "Active" : "Inactive"}
                </span>
              </div>
            ))
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
    </div>
  )
}
