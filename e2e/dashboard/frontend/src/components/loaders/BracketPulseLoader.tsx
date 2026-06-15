// Modal / form-submission loader.
// 4 corner brackets draw in sequence; centre square pulses.
export function BracketPulseLoader({ label }: { label?: string }) {
  const bracketLen = 14 // approx path length for each L-shaped bracket

  const brackets = [
    // top-left
    { d: "M4 12 L4 4 L12 4", delay: "0s" },
    // top-right
    { d: "M28 4 L36 4 L36 12", delay: "0.15s" },
    // bottom-left
    { d: "M4 28 L4 36 L12 36", delay: "0.30s" },
    // bottom-right
    { d: "M36 28 L36 36 L28 36", delay: "0.45s" },
  ]

  return (
    <div
      className="flex flex-col items-center justify-center gap-4"
      role="status"
      aria-label={label ?? "Loading…"}
    >
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
        {brackets.map((b, i) => (
          <path
            key={i}
            d={b.d}
            stroke="#6366f1"
            strokeWidth="1.5"
            strokeLinecap="square"
            strokeDasharray={bracketLen}
            strokeDashoffset={bracketLen}
            style={{
              animation: `scout-bracket-draw 0.4s ease-out ${b.delay} infinite alternate`,
            }}
          />
        ))}
        {/* centre pulse square */}
        <rect
          x="17" y="17" width="6" height="6"
          fill="#6366f1"
          style={{ animation: "scout-centre-pulse 1.2s ease-in-out 0.2s infinite" }}
        />
      </svg>
      {label && (
        <span className="text-muted-foreground text-xs" style={{ letterSpacing: "0.1em" }}>
          {label}
        </span>
      )}
      <style>{`
        @keyframes scout-bracket-draw {
          0%   { stroke-dashoffset: ${bracketLen}; opacity: 0.3; }
          100% { stroke-dashoffset: 0;             opacity: 1;   }
        }
        @keyframes scout-centre-pulse {
          0%, 100% { opacity: 1;   }
          50%       { opacity: 0.2; }
        }
      `}</style>
    </div>
  )
}
