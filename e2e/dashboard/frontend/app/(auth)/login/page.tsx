'use client'

import { useState } from 'react'
import { Check } from 'lucide-react'
import s from './Login.module.css'

export default function LoginPage() {
  const [loading, setLoading] = useState(false)

  const handleLogin = () => {
    setLoading(true)
    window.location.href = '/api/v1/auth/google'
  }

  return (
    <main className={s.page}>
      {/* Animated orbs */}
      <div className={s.orb1} />
      <div className={s.orb2} />

      {/* LEFT — brand showcase */}
      <div className={s.left}>
        <div className={s.logoRow}>
          <div className={s.logoMark}>S</div>
          <span className={s.logoName}>Scout</span>
        </div>

        <div className={s.headline}>
          <span className={s.headlineGradient}>QA automation,</span>
          <span className={s.headlinePlain}>for your entire team.</span>
        </div>

        <p className={s.subtext}>
          Upload tests, run regressions, read reports.<br />
          No CLI required. No Git access needed.
        </p>

        <div className={s.featureList}>
          <div className={s.featureItem}>
            <div className={`${s.featureIcon} ${s.iconEmerald}`}>
              <Check size={13} />
            </div>
            <span className={s.featureText}>Multi-org, multi-product support</span>
          </div>
          <div className={s.featureItem}>
            <div className={`${s.featureIcon} ${s.iconIndigo}`}>
              <Check size={13} />
            </div>
            <span className={s.featureText}>Playwright tests without touching a terminal</span>
          </div>
          <div className={s.featureItem}>
            <div className={`${s.featureIcon} ${s.iconViolet}`}>
              <Check size={13} />
            </div>
            <span className={s.featureText}>AI-powered failure analysis with Groq</span>
          </div>
        </div>

        <span className={s.versionBadge}>v1.0 · Beta</span>
      </div>

      {/* RIGHT — login card */}
      <div className={s.right}>
        <div className={s.card}>
          <div className={s.cardLogoWrap}>
            <div className={s.cardLogoMark}>S</div>
          </div>
          <div className={s.cardTitle}>Welcome back</div>
          <div className={s.cardSub}>Sign in to continue to Scout</div>
          <div className={s.cardDivider} />

          <button
            className={s.googleBtn}
            onClick={handleLogin}
            disabled={loading}
          >
            {loading
              ? <span className={s.spinner} />
              : <GoogleLogo />}
            <span>{loading ? 'Redirecting…' : 'Continue with Google'}</span>
          </button>

          <p className={s.cardNote}>Only workspace members can access Scout.</p>
        </div>

        <div className={s.footerText}>Handcrafted by Simran · ApyHub QA · 2026</div>
      </div>
    </main>
  )
}

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
      <path d="M3.964 10.706A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.038l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.962L3.964 7.294C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  )
}
