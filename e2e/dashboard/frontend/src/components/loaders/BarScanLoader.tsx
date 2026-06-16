// Dashboard data / run results loading state.
// 3 stacked indigo bars with a scanning line that sweeps vertically.
export function BarScanLoader({ label }: { label?: string }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-4"
      role="status"
      aria-label={label ?? "Loading…"}
    >
      <div className="relative flex flex-col gap-[5px]" style={{ width: 80, height: 34 }}>
        {/* bars */}
        <div style={{ height: 8, background: "rgba(99,102,241,0.9)" }} />
        <div style={{ height: 8, background: "rgba(99,102,241,0.6)" }} />
        <div style={{ height: 8, background: "rgba(99,102,241,0.3)" }} />
        {/* scanning line */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: 2,
            height: "100%",
            background: "#6366f1",
            animation: "scout-bar-scan 1.4s ease-in-out infinite alternate",
          }}
        />
      </div>
      {label && (
        <span className="text-muted-foreground text-xs" style={{ letterSpacing: "0.1em" }}>
          {label}
        </span>
      )}
      <style>{`
        @keyframes scout-bar-scan {
          0%   { transform: translateX(0); opacity: 1; }
          100% { transform: translateX(78px); opacity: 0.7; }
        }
      `}</style>
    </div>
  )
}
