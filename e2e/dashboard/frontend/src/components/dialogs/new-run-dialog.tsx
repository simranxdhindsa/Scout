import { useEffect, useState } from "react"
import { Loader2Icon, MonitorIcon, PlayIcon } from "lucide-react"
import { useNavigate } from "react-router-dom"

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
import {
  environmentsApi,
  productsApi,
  runsApi,
  type Environment,
  type Product,
} from "@/lib/scout-api"

export function NewRunDialog({
  open,
  onOpenChange,
  orgId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  orgId: string
}) {
  const navigate = useNavigate()
  const [label, setLabel] = useState("")
  const [envId, setEnvId] = useState("")
  const [productId, setProductId] = useState("")
  const [headed, setHeaded] = useState(false)
  const [environments, setEnvironments] = useState<Environment[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    Promise.all([
      environmentsApi.list(orgId),
      productsApi.list(orgId),
    ]).then(([envs, prods]) => {
      setEnvironments(envs)
      setProducts(prods)
    }).catch(() => {})
  }, [open, orgId])

  const handleSubmit = async () => {
    if (!productId) {
      setError("Select a product to run.")
      return
    }
    setLoading(true)
    setError(null)
    try {
      // Resolve all test cases under the selected product
      const tests = await productsApi.tests(orgId, productId)
      const ids = tests.filter((t) => !t.is_archived).map((t) => t.id)
      if (ids.length === 0) {
        setError("No active tests found for this product.")
        setLoading(false)
        return
      }
      const selectedProduct = products.find((p) => p.id === productId)
      const { run_id } = await runsApi.start(orgId, {
        target_type: "test_case",
        target_ids: ids,
        environment_id: envId || undefined,
        label: label.trim() || `${selectedProduct?.name ?? "Run"} — manual`,
        headed,
      })
      onOpenChange(false)
      navigate(`/runs/${run_id}`)
    } catch (err) {
      setError(
        (err as { response?: { data?: { error?: string } } })?.response?.data
          ?.error ?? "Failed to start run",
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Run</DialogTitle>
          <DialogDescription>
            Pick a product and environment, then launch.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">Product</label>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger>
                <SelectValue placeholder="Select a product…" />
              </SelectTrigger>
              <SelectContent>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">
              Environment <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <Select value={envId} onValueChange={setEnvId}>
              <SelectTrigger>
                <SelectValue placeholder="No environment" />
              </SelectTrigger>
              <SelectContent>
                {environments.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium">
              Label <span className="text-muted-foreground font-normal">(optional)</span>
            </label>
            <Input
              placeholder="e.g. Smoke test before deploy"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>

          <button
            type="button"
            onClick={() => setHeaded((h) => !h)}
            className={`flex items-center gap-3 rounded border px-3 py-2.5 text-sm transition-colors ${
              headed
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
            }`}
          >
            <MonitorIcon className="size-4 shrink-0" />
            <div className="text-left">
              <div className="font-medium">Watch live</div>
              <div className="text-xs opacity-70">
                Opens a real Chrome window so you can see the test run
              </div>
            </div>
            <div
              className={`ml-auto size-4 rounded-full border-2 transition-colors ${
                headed ? "border-primary bg-primary" : "border-muted-foreground"
              }`}
            />
          </button>

          {error ? (
            <p className="text-destructive text-sm">{error}</p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading || !productId}>
            {loading ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <PlayIcon className="size-4" />
            )}
            {loading ? "Starting…" : "Run"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
