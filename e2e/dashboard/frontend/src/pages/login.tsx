import { useEffect } from "react"
import { LoginForm } from "@/components/login-form"
import { ModeToggle } from "@/components/mode-toggle"

export default function LoginPage() {
  useEffect(() => {
    document.title = "SCOUT — QA Automation Platform"
  }, [])

  return (
    <div
      className="relative flex min-h-svh flex-col items-center justify-center gap-8 p-6 md:p-10"
      style={{ background: "#0b0b10" }}
    >
      <div className="absolute top-4 right-4">
        <ModeToggle />
      </div>

      {/* Hero lockup — bracket draw-in runs once on mount */}
      <div className="flex flex-col items-center gap-3">
        <div style={{ animation: "scout-bracket-in 0.8s ease-out both" }}>
          <ScoutHeroMark />
        </div>
        <span
          className="font-bold text-white"
          style={{
            fontSize: 28,
            letterSpacing: "0.5em",
            fontFamily: "'Nunito Sans Variable', 'Nunito Sans', sans-serif",
            animation: "scout-fade-up 0.6s ease-out 1.1s both",
          }}
        >
          SCOUT
        </span>
        <span
          className="text-sm font-semibold"
          style={{
            color: "rgba(99,102,241,0.7)",
            letterSpacing: "0.25em",
            animation: "scout-fade-up 0.6s ease-out 1.3s both",
            fontFamily: "'Nunito Sans Variable', 'Nunito Sans', sans-serif",
          }}
        >
          QA AUTOMATION PLATFORM
        </span>
      </div>

      <div className="w-full max-w-sm">
        <LoginForm />
      </div>
    </div>
  )
}

// Inline 96×96 mark — negative-space cutouts use the dark page background.
function ScoutHeroMark() {
  const bg = "#0b0b10"
  return (
    <svg
      width="96"
      height="96"
      viewBox="0 0 96 96"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M8 26 L8 8 L26 8"    stroke="#6366f1" strokeWidth="2" strokeLinecap="square" fill="none" />
      <path d="M88 26 L88 8 L70 8"  stroke="#6366f1" strokeWidth="2" strokeLinecap="square" fill="none" />
      <path d="M8 70 L8 88 L26 88"  stroke="#6366f1" strokeWidth="2" strokeLinecap="square" fill="none" />
      <path d="M88 70 L88 88 L70 88" stroke="#6366f1" strokeWidth="2" strokeLinecap="square" fill="none" />
      <line x1="8"  y1="46" x2="14" y2="46" stroke="#6366f1" strokeWidth="1" opacity="0.4" />
      <line x1="88" y1="46" x2="82" y2="46" stroke="#6366f1" strokeWidth="1" opacity="0.4" />
      <line x1="46" y1="8"  x2="46" y2="14" stroke="#6366f1" strokeWidth="1" opacity="0.4" />
      <line x1="46" y1="88" x2="46" y2="82" stroke="#6366f1" strokeWidth="1" opacity="0.4" />
      <rect x="28" y="26" width="40" height="10" fill="#6366f1" />
      <rect x="28" y="43" width="40" height="10" fill="#6366f1" />
      <rect x="28" y="60" width="40" height="10" fill="#6366f1" />
      <rect x="28" y="26" width="10" height="27" fill="#6366f1" />
      <rect x="58" y="43" width="10" height="27" fill="#6366f1" />
      <rect x="38" y="26" width="30" height="17" fill={bg} />
      <rect x="28" y="53" width="30" height="17" fill={bg} />
      <rect x="74" y="18" width="6"  height="6"  fill="#22c55e" />
    </svg>
  )
}
