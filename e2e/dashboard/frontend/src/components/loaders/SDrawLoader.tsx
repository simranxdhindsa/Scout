// Page-level / route-transition loader.
// The S letterform draws and undraws as a stroke-dash animation.
export function SDrawLoader({ label }: { label?: string }) {
  // Total path length for "M34 12 L14 12 L14 24 L34 24 L34 36 L14 36" is ~90
  const pathLen = 90

  return (
    <div
      className="flex flex-col items-center justify-center gap-4"
      role="status"
      aria-label={label ?? "Loading…"}
    >
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M34 12 L14 12 L14 24 L34 24 L34 36 L14 36"
          stroke="#6366f1"
          strokeWidth="5"
          strokeLinecap="square"
          strokeDasharray={pathLen}
          strokeDashoffset="0"
          style={{ animation: "scout-sdraw 1.2s ease-in-out infinite alternate" }}
        />
      </svg>
      {label && (
        <span className="text-muted-foreground text-xs" style={{ letterSpacing: "0.1em" }}>
          {label}
        </span>
      )}
      <style>{`
        @keyframes scout-sdraw {
          0%   { stroke-dashoffset: ${pathLen}; }
          100% { stroke-dashoffset: 0; }
        }
      `}</style>
    </div>
  )
}
