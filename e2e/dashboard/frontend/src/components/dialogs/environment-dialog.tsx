import { useEffect, useState } from "react"
import { EyeIcon, EyeOffIcon, Loader2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { environmentsApi, type Environment } from "@/lib/scout-api"

export function EnvironmentDialog({
  orgId,
  env,
  open,
  onOpenChange,
  onSaved,
}: {
  orgId: string | null
  env?: Environment | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: () => Promise<void> | void
}) {
  const isEdit = !!env
  const [name, setName] = useState("")
  const [label, setLabel] = useState("")
  const [baseUrl, setBaseUrl] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName(env?.name ?? "")
      setLabel(env?.label ?? "")
      setBaseUrl(env?.base_url ?? "")
      setUsername(env?.username ?? "")
      setPassword(env?.password ?? "")
      setShowPassword(false)
      setError(null)
      setSaving(false)
    }
  }, [open, env])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!orgId || !name.trim()) return
    setSaving(true)
    setError(null)
    const body = {
      name: name.trim(),
      label: label.trim() || undefined,
      base_url: baseUrl.trim() || undefined,
      username: username.trim() || undefined,
      password: password || undefined,
    }
    try {
      if (env) {
        await environmentsApi.update(orgId, env.id, body)
      } else {
        await environmentsApi.create(orgId, body)
      }
      await onSaved?.()
      onOpenChange(false)
    } catch (err) {
      setError(
        (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error ??
          (isEdit
            ? "Failed to update environment"
            : "Failed to create environment"),
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit environment" : "New environment"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the environment's URL and credentials."
              : "Define an environment with a base URL and optional credentials."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium" htmlFor="env-name">
                Name
              </label>
              <Input
                id="env-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="staging"
                required
                autoFocus
                className="bg-muted/40 px-3"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium" htmlFor="env-label">
                Label
              </label>
              <Input
                id="env-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="QA staging cluster"
                className="bg-muted/40 px-3"
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="env-url">
              URL
            </label>
            <Input
              id="env-url"
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://staging.example.com"
              className="bg-muted/40 px-3"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="env-username">
              Username / Email
            </label>
            <Input
              id="env-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="user@example.com"
              autoComplete="off"
              className="bg-muted/40 px-3"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="env-password">
              Password
            </label>
            <div className="relative">
              <Input
                id="env-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
                className="bg-muted/40 px-3 pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <EyeOffIcon className="size-4" />
                ) : (
                  <EyeIcon className="size-4" />
                )}
              </button>
            </div>
          </div>

          {error ? <p className="text-destructive text-sm">{error}</p> : null}

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !name.trim() || !orgId}>
              {saving ? <Loader2Icon className="size-4 animate-spin" /> : null}
              {isEdit ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
