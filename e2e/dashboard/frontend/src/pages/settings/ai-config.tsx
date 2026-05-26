import { useEffect, useState } from "react"
import {
  BotIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  Loader2Icon,
  SaveIcon,
  SearchIcon,
  XIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuthStore } from "@/lib/auth"
import {
  AI_CONFIG_DEFAULTS,
  AI_MODELS,
  aiConfigApi,
  type AiConfig,
} from "@/lib/scout-api"

type Toast = { kind: "success" | "error"; text: string }

type ApiError = { response?: { data?: { error?: string } } }

function readError(err: unknown, fallback: string) {
  return (err as ApiError)?.response?.data?.error ?? fallback
}

export default function AiConfigPage() {
  const org = useAuthStore((s) => s.orgs[0] ?? null)
  const [config, setConfig] = useState<AiConfig | null>(null)
  const [draft, setDraft] = useState<AiConfig>(AI_CONFIG_DEFAULTS)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)

  useEffect(() => {
    if (!org) return
    aiConfigApi
      .get(org.id)
      .then((cfg) => {
        setConfig(cfg)
        setDraft(cfg)
      })
      .catch(() => {
        setConfig(AI_CONFIG_DEFAULTS)
        setDraft(AI_CONFIG_DEFAULTS)
      })
  }, [org])

  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), 3500)
    return () => window.clearTimeout(id)
  }, [toast])

  const isDirty =
    !!config &&
    (config.system_prompt !== draft.system_prompt ||
      config.model !== draft.model ||
      config.temperature !== draft.temperature ||
      config.max_tokens !== draft.max_tokens ||
      config.rag_enabled !== draft.rag_enabled)

  const save = async () => {
    if (!org || !isDirty) return
    setSaving(true)
    try {
      const saved = await aiConfigApi.update(org.id, {
        ...draft,
        max_tokens: Math.min(8192, Math.max(256, Math.round(draft.max_tokens))),
        temperature: Math.min(1, Math.max(0, draft.temperature)),
      })
      setConfig(saved)
      setDraft(saved)
      setToast({ kind: "success", text: "AI config saved" })
    } catch (err) {
      setToast({ kind: "error", text: readError(err, "Failed to save config") })
    } finally {
      setSaving(false)
    }
  }

  const loading = config === null

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">
          AI Configuration
        </h1>
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
        <div className="flex items-start gap-4">
          <div className="bg-primary/20 ring-primary/30 inline-flex size-11 items-center justify-center ring-1">
            <BotIcon className="text-primary size-5" />
          </div>
          <div>
            <h2 className="text-base font-semibold">Scout AI Settings</h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Configure the AI assistant for your organisation
            </p>
          </div>
        </div>

        {loading ? (
          <Skeleton className="h-72 w-full" />
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium" htmlFor="system-prompt">
                System Prompt
              </label>
              <textarea
                id="system-prompt"
                rows={6}
                value={draft.system_prompt}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, system_prompt: e.target.value }))
                }
                placeholder="You are a QA expert for [Company]. Focus on..."
                className="bg-muted/40 ring-border/40 placeholder:text-muted-foreground resize-y p-3 font-mono text-sm outline-none ring-1 focus-visible:ring-primary"
              />
              <p className="text-muted-foreground text-xs">
                Leave blank to use Scout's default QA-focused system prompt.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium" htmlFor="model">
                Model
              </label>
              <div className="bg-muted/40 ring-border/40 relative ring-1">
                <select
                  id="model"
                  value={draft.model}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, model: e.target.value }))
                  }
                  className="w-full appearance-none bg-transparent px-3 py-2 text-sm outline-none"
                >
                  {AI_MODELS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                  {!AI_MODELS.includes(draft.model as (typeof AI_MODELS)[number]) ? (
                    <option value={draft.model}>{draft.model} (custom)</option>
                  ) : null}
                </select>
                <ChevronDownIcon className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2" />
              </div>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              <div className="flex flex-col gap-3">
                <label className="text-sm font-medium" htmlFor="temperature">
                  Temperature{" "}
                  <span className="text-muted-foreground font-normal">
                    ({draft.temperature.toFixed(2)})
                  </span>
                </label>
                <input
                  id="temperature"
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={draft.temperature}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      temperature: parseFloat(e.target.value),
                    }))
                  }
                  className="accent-primary"
                />
                <div className="text-muted-foreground flex justify-between text-xs">
                  <span>Precise (0)</span>
                  <span>Creative (1)</span>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium" htmlFor="max-tokens">
                  Max Tokens
                </label>
                <Input
                  id="max-tokens"
                  type="number"
                  min={256}
                  max={8192}
                  step={256}
                  value={draft.max_tokens}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      max_tokens: Number(e.target.value),
                    }))
                  }
                  className="bg-muted/40"
                />
              </div>
            </div>

            <div className="bg-muted/40 ring-border/40 flex items-center justify-between p-4 ring-1">
              <div>
                <div className="text-sm font-semibold">
                  Context-Aware Responses (RAG)
                </div>
                <div className="text-muted-foreground text-xs">
                  Inject relevant test history into every AI response
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={draft.rag_enabled}
                onClick={() =>
                  setDraft((d) => ({ ...d, rag_enabled: !d.rag_enabled }))
                }
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors ${
                  draft.rag_enabled ? "bg-primary" : "bg-muted"
                }`}
              >
                <span
                  className={`bg-background inline-block size-5 translate-y-0.5 transform rounded-full transition-transform ${
                    draft.rag_enabled ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>

            <div className="flex justify-end">
              <Button onClick={save} disabled={!isDirty || saving}>
                {saving ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : (
                  <SaveIcon className="size-4" />
                )}
                Save Config
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
