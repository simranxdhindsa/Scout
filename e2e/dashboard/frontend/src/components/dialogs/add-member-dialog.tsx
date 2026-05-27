import { useEffect, useState } from "react"
import { Loader2Icon } from "lucide-react"

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { membersApi, type MemberRole } from "@/lib/scout-api"

export function AddMemberDialog({
  orgId,
  open,
  onOpenChange,
  onAdded,
}: {
  orgId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdded?: () => Promise<void> | void
}) {
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<MemberRole>("member")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setEmail("")
      setRole("member")
      setSaving(false)
      setError(null)
    }
  }, [open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!orgId || !email.trim()) return
    setSaving(true)
    setError(null)
    try {
      await membersApi.add(orgId, { email: email.trim(), role })
      await onAdded?.()
      onOpenChange(false)
    } catch (err) {
      setError(
        (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error ?? "Failed to add member",
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add member</DialogTitle>
          <DialogDescription>
            Invite a teammate to this organisation. They must have signed in
            with Google at least once.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="add-member-email">
              Email
            </label>
            <Input
              id="add-member-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@company.com"
              required
              autoFocus
              className="bg-muted/40 px-3"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="add-member-role">
              Role
            </label>
            <Select
              value={role}
              onValueChange={(v) => setRole(v as MemberRole)}
            >
              <SelectTrigger id="add-member-role" className="bg-muted/40 w-full capitalize">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">Member</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
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
            <Button type="submit" disabled={saving || !email.trim() || !orgId}>
              {saving ? <Loader2Icon className="size-4 animate-spin" /> : null}
              Add member
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
