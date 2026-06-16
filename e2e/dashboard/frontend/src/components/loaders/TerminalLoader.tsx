// Test-run initiation / pipeline-starting loader.
// "SCOUT" label, 3 pulsing squares, "running tests…" status line.
export function TerminalLoader({ label }: { label?: string }) {
  const dots = [0, 1, 2]

  return (
    <div
      className="flex flex-col items-center justify-center gap-3"
      role="status"
      aria-label={label ?? "Starting…"}
    >
      <span
        className="text-xs font-bold"
        style={{
          color: "rgba(99,102,241,0.6)",
          letterSpacing: "0.5em",
          fontFamily: "'Nunito Sans Variable', 'Nunito Sans', sans-serif",
        }}
      >
        SCOUT
      </span>
      <div className="flex items-center gap-1.5">
        {dots.map((i) => (
          <span
            key={i}
            style={{
              display: "inline-block",
              width: 6,
              height: 6,
              background: "#6366f1",
              animation: `scout-dot-seq 0.9s ease-in-out ${i * 0.2}s infinite`,
            }}
          />
        ))}
      </div>
      <span
        className="text-xs"
        style={{ color: "#22c55e", letterSpacing: "0.08em" }}
      >
        {label ?? "running tests…"}
      </span>
      <style>{`
        @keyframes scout-dot-seq {
          0%, 80%, 100% { opacity: 0.2; }
          40%            { opacity: 1;   }
        }
      `}</style>
    </div>
  )
}
