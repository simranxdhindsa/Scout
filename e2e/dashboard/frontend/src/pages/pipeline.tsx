import { useEffect, useState } from "react"
import {
  GitBranchIcon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react"

import { AddPipelineDialog } from "@/components/dialogs/add-pipeline-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { useActiveOrg } from "@/lib/auth"
import {
  pipelinesApi,
  type Pipeline,
} from "@/lib/scout-api"

type Editing =
  | { mode: "create" }
  | { mode: "edit"; pipeline: Pipeline }
  | null

export default function PipelinePage() {
  const org = useActiveOrg()
  const [pipelines, setPipelines] = useState<Pipeline[] | null>(null)
  const [editing, setEditing] = useState<Editing>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    if (!org) return
    pipelinesApi
      .list(org.id)
      .then(setPipelines)
      .catch(() => setPipelines([]))
  }, [org])

  const refresh = async () => {
    if (!org) return
    const list = await pipelinesApi.list(org.id)
    setPipelines(list)
  }

  const handleDelete = async (pipeline: Pipeline) => {
    if (!org) return
    if (!confirm(`Delete pipeline "${pipeline.name}"?`)) return
    setDeletingId(pipeline.id)
    try {
      await pipelinesApi.remove(org.id, pipeline.id)
      await refresh()
    } finally {
      setDeletingId(null)
    }
  }

  const isEmpty = pipelines !== null && pipelines.length === 0

  return (
    <div className="flex min-h-[calc(100vh-7rem)] flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">Pipelines</h1>
        <div className="flex items-center gap-2">
          <Button onClick={() => setEditing({ mode: "create" })} disabled={!org}>
            <PlusIcon className="size-4" />
            New Pipeline
          </Button>
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

      {pipelines === null ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-36" />
          ))}
        </div>
      ) : isEmpty ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <GitBranchIcon
            className="text-muted-foreground size-10"
            strokeWidth={1.5}
          />
          <div>
            <h2 className="text-lg font-semibold">No pipelines yet</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Create a pipeline to chain test runs across products
            </p>
          </div>
          <Button onClick={() => setEditing({ mode: "create" })}>
            <PlusIcon className="size-4" />
            Create Pipeline
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {pipelines.map((p) => (
            <div
              key={p.id}
              className="bg-card/40 ring-border/40 flex flex-col gap-3 p-5 ring-1"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold">{p.name}</h3>
                  {p.description ? (
                    <p className="text-muted-foreground mt-1 text-sm">
                      {p.description}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setEditing({ mode: "edit", pipeline: p })}
                    className="bg-muted/60 ring-border/40 hover:bg-accent inline-flex size-8 items-center justify-center ring-1"
                    aria-label="Edit"
                  >
                    <PencilIcon className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={deletingId === p.id}
                    onClick={() => handleDelete(p)}
                    className="bg-rose-500/10 ring-rose-500/30 hover:bg-rose-500/20 text-rose-300 inline-flex size-8 items-center justify-center ring-1 disabled:opacity-50"
                    aria-label="Delete"
                  >
                    {deletingId === p.id ? (
                      <Loader2Icon className="size-3.5 animate-spin" />
                    ) : (
                      <Trash2Icon className="size-3.5" />
                    )}
                  </button>
                </div>
              </div>
              <div className="text-muted-foreground text-xs">
                {p.steps.length} step{p.steps.length === 1 ? "" : "s"}
              </div>
              {p.steps.length > 0 ? (
                <ol className="flex flex-col gap-1">
                  {p.steps
                    .slice()
                    .sort((a, b) => a.order - b.order)
                    .map((s, i) => (
                      <li
                        key={s.id}
                        className="bg-muted/40 ring-border/40 flex items-center gap-2 px-2.5 py-1.5 text-xs ring-1"
                      >
                        <span className="text-muted-foreground font-mono">
                          {i + 1}.
                        </span>
                        <span className="bg-muted/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wider">
                          {s.target_type}
                        </span>
                        <span className="truncate">{s.target_label}</span>
                      </li>
                    ))}
                </ol>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {editing && org ? (
        <AddPipelineDialog
          open
          onOpenChange={(o) => {
            if (!o) setEditing(null)
          }}
          orgId={org.id}
          mode={editing}
          onSaved={async () => {
            setEditing(null)
            await refresh()
          }}
        />
      ) : null}
    </div>
  )
}
