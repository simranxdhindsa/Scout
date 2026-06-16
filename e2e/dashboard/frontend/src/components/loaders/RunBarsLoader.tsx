// Analytics / sprint / pipeline loading state.
// 4 vertical bars animate scaleY from 0→1 from bottom, last bar in green.
export function RunBarsLoader({ label }: { label?: string }) {
  const bars = [
    { h: 30, color: "#6366f1", delay: "0s" },
    { h: 46, color: "#6366f1", delay: "0.15s" },
    { h: 22, color: "#6366f1", delay: "0.30s" },
    { h: 38, color: "#22c55e", delay: "0.45s" },
  ]

  return (
    <div
      className="flex flex-col items-center justify-center gap-4"
      role="status"
      aria-label={label ?? "Loading…"}
    >
      <div className="flex items-end gap-1.5" style={{ height: 48 }}>
        {bars.map((b, i) => (
          <div
            key={i}
            style={{
              width: 10,
              height: b.h,
              background: b.color,
              transformOrigin: "bottom",
              animation: `scout-bar-scale 0.6s ease-in-out ${b.delay} infinite alternate`,
            }}
          />
        ))}
      </div>
      {label && (
        <span className="text-muted-foreground text-xs" style={{ letterSpacing: "0.1em" }}>
          {label}
        </span>
      )}
      <style>{`
        @keyframes scout-bar-scale {
          0%   { transform: scaleY(0); opacity: 0.4; }
          100% { transform: scaleY(1); opacity: 1;   }
        }
      `}</style>
    </div>
  )
}
