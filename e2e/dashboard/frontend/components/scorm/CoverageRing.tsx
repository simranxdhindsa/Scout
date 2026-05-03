'use client'

interface CoverageRingProps {
  pct: number        // 0–100
  size?: number      // px, default 80
  stroke?: number    // stroke width, default 8
  label?: string
}

export function CoverageRing({ pct, size = 80, stroke = 8, label }: CoverageRingProps) {
  const r = (size - stroke) / 2
  const circumference = 2 * Math.PI * r
  const filled = ((pct ?? 0) / 100) * circumference
  const color = pct >= 80 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#ef4444'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        {/* Track */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={stroke}
        />
        {/* Fill */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={`${filled} ${circumference - filled}`}
          strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.6s ease' }}
        />
        {/* Centre text — un-rotate the group */}
        <text
          x="50%"
          y="50%"
          textAnchor="middle"
          dominantBaseline="middle"
          style={{
            transform: `rotate(90deg)`,
            transformOrigin: 'center',
            fontSize: size * 0.2,
            fontWeight: 700,
            fill: color,
            fontFamily: 'inherit',
          }}
        >
          {Math.round(pct)}%
        </text>
      </svg>
      {label && <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{label}</p>}
    </div>
  )
}
