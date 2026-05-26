import axios from "axios"

import { clearToken, getToken } from "@/lib/auth"

export const API_BASE_URL =
  import.meta.env.VITE_SCOUT_API_URL ?? "http://localhost:8080"

export const api = axios.create({
  baseURL: `${API_BASE_URL}/api/v1`,
})

api.interceptors.request.use((cfg) => {
  const token = getToken()
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  return cfg
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      clearToken()
      if (window.location.pathname !== "/login") {
        window.location.href = "/login"
      }
    }
    return Promise.reject(err)
  },
)

export function googleLoginUrl() {
  return `${API_BASE_URL}/api/v1/auth/google`
}
