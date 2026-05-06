import { create } from 'zustand'
import { authApi } from './api'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface User {
  id: string
  email: string
  name: string
  avatar_url: string
  created_at: string
}

export interface Organization {
  id: string
  name: string
  slug: string
  theme: Record<string, string>
  is_active: boolean
  created_at: string
}

export interface AuthState {
  user: User | null
  orgs: Organization[]
  isPlatformAdmin: boolean
  isLoading: boolean
  isAuthenticated: boolean

  // Actions
  loadMe: () => Promise<void>
  logout: () => Promise<void>
  setToken: (token: string) => void
  clear: () => void
}

// ── Cookie helpers ────────────────────────────────────────────────────────────

export function setAuthCookie(token: string) {
  // HttpOnly would be safer but requires server-side setting.
  // For client-side SPA we use Secure + SameSite=Strict.
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toUTCString()
  document.cookie = `scout_token=${encodeURIComponent(token)}; expires=${expires}; path=/; SameSite=Strict${location.protocol === 'https:' ? '; Secure' : ''}`
}

export function clearAuthCookie() {
  document.cookie = 'scout_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;'
}

export function getAuthToken(): string | undefined {
  if (typeof document === 'undefined') return undefined
  const match = document.cookie.match(/(^| )scout_token=([^;]+)/)
  return match ? decodeURIComponent(match[2]) : undefined
}

// ── Zustand store ─────────────────────────────────────────────────────────────

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  orgs: [],
  isPlatformAdmin: false,
  isLoading: true,
  isAuthenticated: false,

  setToken: (token: string) => {
    setAuthCookie(token)
  },

  loadMe: async () => {
    set({ isLoading: true })
    try {
      const res = await authApi.me()
      const { user, orgs, is_platform_admin } = res.data
      set({
        user,
        orgs: orgs ?? [],
        isPlatformAdmin: is_platform_admin ?? false,
        isAuthenticated: true,
        isLoading: false,
      })
    } catch {
      set({
        user: null,
        orgs: [],
        isPlatformAdmin: false,
        isAuthenticated: false,
        isLoading: false,
      })
    }
  },

  logout: async () => {
    try {
      await authApi.logout()
    } catch {
      // Ignore logout errors — clear state regardless
    }
    clearAuthCookie()
    set({
      user: null,
      orgs: [],
      isPlatformAdmin: false,
      isAuthenticated: false,
      isLoading: false,
    })
    window.location.href = '/login'
  },

  clear: () => {
    clearAuthCookie()
    set({
      user: null,
      orgs: [],
      isPlatformAdmin: false,
      isAuthenticated: false,
      isLoading: false,
    })
  },
}))

// ── JWT decode helper ─────────────────────────────────────────────────────────

export function decodeToken(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))
    return JSON.parse(payload)
  } catch {
    return null
  }
}

// ── Current org helper ────────────────────────────────────────────────────────

export function useCurrentOrg(slug: string): Organization | undefined {
  const orgs = useAuthStore((s) => s.orgs)
  return orgs.find((o) => o.slug === slug)
}
