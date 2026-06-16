import { ScoutIconMark } from "@/components/ScoutLogo"

interface ScoutEmptyStateProps {
  message: string
  sub?: string
}

export function ScoutEmptyState({ message, sub }: ScoutEmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      <div style={{ opacity: 0.4 }}>
        <ScoutIconMark size={48} bg="transparent" />
      </div>
      <p className="text-sm font-medium">{message}</p>
      {sub && <p className="text-muted-foreground text-xs">{sub}</p>}
    </div>
  )
}
