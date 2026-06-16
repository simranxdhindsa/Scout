"use client"

import { useSidebar } from "@/components/ui/sidebar"

// bg="transparent" lets the SVG cutouts show whatever surface is behind them,
// making the mark correct on both light and dark backgrounds without theme detection.
function SMarkIcon({
  size = 20,
  bg = "transparent",
}: {
  size?: number
  bg?: string
}) {
  const f = size / 96
  const r = (x: number) => Math.round(x * f * 100) / 100

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* corner brackets */}
      <path
        d={`M${r(8)} ${r(26)} L${r(8)} ${r(8)} L${r(26)} ${r(8)}`}
        stroke="#6366f1"
        strokeWidth={r(2)}
        strokeLinecap="square"
        fill="none"
      />
      <path
        d={`M${r(88)} ${r(26)} L${r(88)} ${r(8)} L${r(70)} ${r(8)}`}
        stroke="#6366f1"
        strokeWidth={r(2)}
        strokeLinecap="square"
        fill="none"
      />
      <path
        d={`M${r(8)} ${r(70)} L${r(8)} ${r(88)} L${r(26)} ${r(88)}`}
        stroke="#6366f1"
        strokeWidth={r(2)}
        strokeLinecap="square"
        fill="none"
      />
      <path
        d={`M${r(88)} ${r(70)} L${r(88)} ${r(88)} L${r(70)} ${r(88)}`}
        stroke="#6366f1"
        strokeWidth={r(2)}
        strokeLinecap="square"
        fill="none"
      />
      {/* tick marks */}
      <line x1={r(8)}  y1={r(46)} x2={r(14)} y2={r(46)} stroke="#6366f1" strokeWidth={r(1)} opacity="0.4" />
      <line x1={r(88)} y1={r(46)} x2={r(82)} y2={r(46)} stroke="#6366f1" strokeWidth={r(1)} opacity="0.4" />
      <line x1={r(46)} y1={r(8)}  x2={r(46)} y2={r(14)} stroke="#6366f1" strokeWidth={r(1)} opacity="0.4" />
      <line x1={r(46)} y1={r(88)} x2={r(46)} y2={r(82)} stroke="#6366f1" strokeWidth={r(1)} opacity="0.4" />
      {/* S mark: 3 bars */}
      <rect x={r(28)} y={r(26)} width={r(40)} height={r(10)} fill="#6366f1" />
      <rect x={r(28)} y={r(43)} width={r(40)} height={r(10)} fill="#6366f1" />
      <rect x={r(28)} y={r(60)} width={r(40)} height={r(10)} fill="#6366f1" />
      {/* S connectors */}
      <rect x={r(28)} y={r(26)} width={r(10)} height={r(27)} fill="#6366f1" />
      <rect x={r(58)} y={r(43)} width={r(10)} height={r(27)} fill="#6366f1" />
      {/* negative-space cutouts — transparent so the surface behind shows through */}
      <rect x={r(38)} y={r(26)} width={r(30)} height={r(17)} fill={bg} />
      <rect x={r(28)} y={r(53)} width={r(30)} height={r(17)} fill={bg} />
      {/* live status dot */}
      <rect x={r(74)} y={r(18)} width={r(6)} height={r(6)} fill="#22c55e" />
    </svg>
  )
}

const sizeMap = { sm: 16, md: 20, lg: 48 } as const
const largeSizeMap = { sm: 16, md: 20, lg: 96 } as const

interface ScoutLogoProps {
  variant?: "icon" | "horizontal" | "sidebar"
  size?: "sm" | "md" | "lg"
  theme?: "dark" | "light" | "auto"
  showStatusDot?: boolean
  animate?: boolean
}

function SidebarVariant({ size, showStatusDot, animate }: Omit<ScoutLogoProps, "variant">) {
  const { state } = useSidebar()
  const collapsed = state === "collapsed"
  const iconSize = sizeMap[size ?? "md"]

  return (
    <div className="flex items-center gap-2 overflow-hidden">
      <SMarkIcon size={iconSize} />
      {!collapsed && (
        <>
          <span
            className="flex-1 text-sm font-bold text-foreground"
            style={{ letterSpacing: "0.18em", fontFamily: "'Nunito Sans Variable', 'Nunito Sans', sans-serif" }}
          >
            SCOUT
          </span>
          {showStatusDot !== false && (
            <span
              className="ml-auto shrink-0"
              style={{
                width: 6,
                height: 6,
                background: "#22c55e",
                animation: animate ? "scout-pulse 1.8s ease-in-out infinite" : undefined,
              }}
            />
          )}
        </>
      )}
    </div>
  )
}

export function ScoutLogo({
  variant = "horizontal",
  size = "md",
  theme = "auto",
  showStatusDot = true,
  animate = false,
}: ScoutLogoProps) {
  const iconSize = variant === "sidebar" ? sizeMap[size] : largeSizeMap[size]

  if (variant === "sidebar") {
    return <SidebarVariant size={size} theme={theme} showStatusDot={showStatusDot} animate={animate} />
  }

  if (variant === "icon") {
    return <SMarkIcon size={iconSize} />
  }

  // horizontal — wordmark color via CSS so it adapts to light/dark automatically
  const explicitColor =
    theme === "light" ? "#0b0b10" : theme === "dark" ? "#ffffff" : undefined

  return (
    <div className="inline-flex items-center gap-3">
      <SMarkIcon size={iconSize} />
      <div className="flex flex-col">
        <span
          className={`font-bold leading-none${explicitColor ? "" : " text-foreground"}`}
          style={{
            letterSpacing: "0.5em",
            fontSize: iconSize * 0.6,
            fontFamily: "'Nunito Sans Variable', 'Nunito Sans', sans-serif",
            ...(explicitColor ? { color: explicitColor } : {}),
          }}
        >
          SCOUT
        </span>
      </div>
      {showStatusDot && (
        <span
          style={{
            width: 6,
            height: 6,
            background: "#22c55e",
            flexShrink: 0,
            animation: animate ? "scout-pulse 1.8s ease-in-out infinite" : undefined,
          }}
        />
      )}
    </div>
  )
}

// 48px icon mark for empty states — transparent bg so it reads on any surface
export function ScoutIconMark({ size = 48, bg = "transparent" }: { size?: number; bg?: string }) {
  return <SMarkIcon size={size} bg={bg} />
}
