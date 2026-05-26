import { create } from "zustand"

import type { MeResponse, ScoutOrg, ScoutUser } from "@/lib/scout-api"

// ── Cookie helpers ────────────────────────────────────────────────────

export const TOKEN_COOKIE = "scout_token"
const ACTIVE_ORG_KEY = "scout_active_org_id"

function readActiveOrgId(): string | null {
  if (typeof localStorage === "undefined") return null
  return localStorage.getItem(ACTIVE_ORG_KEY)
}

function writeActiveOrgId(id: string | null) {
  if (typeof localStorage === "undefined") return
  if (id) localStorage.setItem(ACTIVE_ORG_KEY, id)
  else localStorage.removeItem(ACTIVE_ORG_KEY)
}

export function setAuthCookie(token: string) {
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toUTCString()
  const secure = location.protocol === "https:" ? "; Secure" : ""
  document.cookie =
    `${TOKEN_COOKIE}=${encodeURIComponent(token)}; expires=${expires}; ` +
    `path=/; SameSite=Lax${secure}`
}

export function clearAuthCookie() {
  document.cookie = `${TOKEN_COOKIE}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`
}

export function getAuthToken(): string | undefined {
  if (typeof document === "undefined") return
  const m = document.cookie.match(
    new RegExp(`(?:^|; )${TOKEN_COOKIE}=([^;]+)`),
  )
  return m ? decodeURIComponent(m[1]) : undefined
}

// Back-compat aliases used elsewhere in the app.
export const getToken = (): string | null => getAuthToken() ?? null
export const setToken = setAuthCookie
export const clearToken = clearAuthCookie

// ── Zustand store ─────────────────────────────────────────────────────

export interface AuthState {
  user: ScoutUser | null
  orgs: ScoutOrg[]
  activeOrgId: string | null
  isPlatformAdmin: boolean
  isLoading: boolean
  isAuthenticated: boolean
  loadMe: () => Promise<void>
  logout: () => Promise<void>
  setToken: (token: string) => void
  setActiveOrgId: (id: string | null) => void
  clear: () => void
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  orgs: [],
  activeOrgId: readActiveOrgId(),
  isPlatformAdmin: false,
  isLoading: true,
  isAuthenticated: false,

  setToken: (token) => setAuthCookie(token),

  setActiveOrgId: (id) => {
    writeActiveOrgId(id)
    set({ activeOrgId: id })
  },

  loadMe: async () => {
    if (!getAuthToken()) {
      set({
        user: null,
        orgs: [],
        activeOrgId: null,
        isPlatformAdmin: false,
        isAuthenticated: false,
        isLoading: false,
      })
      return
    }
    set({ isLoading: true })
    try {
      const { api } = await import("@/lib/api")
      const res = await api.get<MeResponse>("/auth/me")
      const orgs = res.data.orgs ?? []
      const stored = get().activeOrgId
      const activeOrgId =
        stored && orgs.some((o) => o.id === stored)
          ? stored
          : (orgs[0]?.id ?? null)
      writeActiveOrgId(activeOrgId)
      set({
        user: res.data.user,
        orgs,
        activeOrgId,
        isPlatformAdmin: res.data.is_platform_admin ?? false,
        isAuthenticated: true,
        isLoading: false,
      })
    } catch {
      set({
        user: null,
        orgs: [],
        activeOrgId: null,
        isPlatformAdmin: false,
        isAuthenticated: false,
        isLoading: false,
      })
    }
  },

  logout: async () => {
    try {
      const { api } = await import("@/lib/api")
      await api.post("/auth/logout")
    } catch {
      // ignore — clear local state regardless
    }
    clearAuthCookie()
    writeActiveOrgId(null)
    set({
      user: null,
      orgs: [],
      activeOrgId: null,
      isPlatformAdmin: false,
      isAuthenticated: false,
      isLoading: false,
    })
    window.location.href = "/login"
  },

  clear: () => {
    clearAuthCookie()
    writeActiveOrgId(null)
    set({
      user: null,
      orgs: [],
      activeOrgId: null,
      isPlatformAdmin: false,
      isAuthenticated: false,
      isLoading: false,
    })
  },
}))

export function useCurrentOrg(orgSlug: string) {
  return useAuthStore((s) => s.orgs.find((o) => o.slug === orgSlug))
}
