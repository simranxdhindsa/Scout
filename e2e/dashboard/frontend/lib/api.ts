import axios, { AxiosInstance, AxiosRequestConfig } from 'axios'

// ── API client singleton ──────────────────────────────────────────────────────

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'

function createClient(): AxiosInstance {
  const client = axios.create({
    baseURL: BASE_URL,
    timeout: 30_000,
    headers: { 'Content-Type': 'application/json' },
  })

  // Attach JWT from cookie on every request
  client.interceptors.request.use((config) => {
    if (typeof document !== 'undefined') {
      const token = getCookie('scout_token')
      if (token) {
        config.headers.Authorization = `Bearer ${token}`
      }
    }
    return config
  })

  // Redirect to login on 401
  client.interceptors.response.use(
    (res) => res,
    (err) => {
      if (err.response?.status === 401 && typeof window !== 'undefined') {
        window.location.href = '/login'
      }
      return Promise.reject(err)
    }
  )

  return client
}

export const api = createClient()

function getCookie(name: string): string | undefined {
  const match = document.cookie.match(new RegExp(`(^| )${name}=([^;]+)`))
  return match ? decodeURIComponent(match[2]) : undefined
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export const authApi = {
  me: () => api.get('/api/v1/auth/me'),
  logout: () => api.post('/api/v1/auth/logout'),
}

// ── Organizations ─────────────────────────────────────────────────────────────

export const orgsApi = {
  list: () => api.get('/api/v1/orgs'),
  get: (orgId: string) => api.get(`/api/v1/orgs/${orgId}`),
}

// ── Members ───────────────────────────────────────────────────────────────────

export const membersApi = {
  list: (orgId: string) => api.get(`/api/v1/orgs/${orgId}/members`),
  add: (orgId: string, data: { email: string; role: string }) =>
    api.post(`/api/v1/orgs/${orgId}/members`, data),
  update: (orgId: string, memberId: string, data: object) =>
    api.put(`/api/v1/orgs/${orgId}/members/${memberId}`, data),
  remove: (orgId: string, memberId: string) =>
    api.delete(`/api/v1/orgs/${orgId}/members/${memberId}`),
}

// ── Products ──────────────────────────────────────────────────────────────────

export const productsApi = {
  list: (orgId: string) => api.get(`/api/v1/orgs/${orgId}/products`),
  create: (orgId: string, data: object) => api.post(`/api/v1/orgs/${orgId}/products`, data),
  update: (orgId: string, productId: string, data: object) =>
    api.put(`/api/v1/orgs/${orgId}/products/${productId}`, data),
  delete: (orgId: string, productId: string) =>
    api.delete(`/api/v1/orgs/${orgId}/products/${productId}`),
}

// ── Sub-projects ──────────────────────────────────────────────────────────────

export const subProjectsApi = {
  list: (orgId: string, productId: string) =>
    api.get(`/api/v1/orgs/${orgId}/products/${productId}/subprojects`),
  create: (orgId: string, productId: string, data: object) =>
    api.post(`/api/v1/orgs/${orgId}/products/${productId}/subprojects`, data),
  update: (orgId: string, productId: string, spId: string, data: object) =>
    api.put(`/api/v1/orgs/${orgId}/products/${productId}/subprojects/${spId}`, data),
  delete: (orgId: string, productId: string, spId: string) =>
    api.delete(`/api/v1/orgs/${orgId}/products/${productId}/subprojects/${spId}`),
  rootFolder: (spId: string) =>
    api.get(`/api/v1/subprojects/${spId}/root-folder`),
}

// ── Environments ──────────────────────────────────────────────────────────────

export const environmentsApi = {
  list: (orgId: string) => api.get(`/api/v1/orgs/${orgId}/environments`),
  create: (orgId: string, data: object) => api.post(`/api/v1/orgs/${orgId}/environments`, data),
  update: (orgId: string, envId: string, data: object) =>
    api.put(`/api/v1/orgs/${orgId}/environments/${envId}`, data),
  delete: (orgId: string, envId: string) =>
    api.delete(`/api/v1/orgs/${orgId}/environments/${envId}`),
  listEnvURLs: (spId: string) => api.get(`/api/v1/subprojects/${spId}/env-urls`),
  setEnvURL: (spId: string, data: object) => api.put(`/api/v1/subprojects/${spId}/env-urls`, data),
}

// ── Folders ───────────────────────────────────────────────────────────────────

export const foldersApi = {
  tree: (spId: string) => api.get(`/api/v1/subprojects/${spId}/folders`),
  create: (spId: string, data: object) => api.post(`/api/v1/subprojects/${spId}/folders`, data),
  rename: (folderId: string, name: string) => api.put(`/api/v1/folders/${folderId}`, { name }),
  delete: (folderId: string) => api.delete(`/api/v1/folders/${folderId}`),
}

// ── Tests ─────────────────────────────────────────────────────────────────────

export const testsApi = {
  list: (folderId: string) => api.get(`/api/v1/folders/${folderId}/tests`),
  get: (testId: string) => api.get(`/api/v1/tests/${testId}`),
  upload: (folderId: string, data: FormData | object, isFormData = false) =>
    api.post(`/api/v1/folders/${folderId}/tests`, data, {
      headers: isFormData ? { 'Content-Type': 'multipart/form-data' } : undefined,
    } as AxiosRequestConfig),
  update: (testId: string, data: object) => api.put(`/api/v1/tests/${testId}`, data),
  versions: (testId: string) => api.get(`/api/v1/tests/${testId}/versions`),
  validate: (data: object) => api.post('/api/v1/tests/validate', data),
  archiveRequest: (testId: string, data: object) =>
    api.post(`/api/v1/tests/${testId}/archive-request`, data),
  listArchiveQueue: (orgId: string) => api.get(`/api/v1/orgs/${orgId}/archive-queue`),
  approveArchive: (orgId: string, requestId: string) =>
    api.post(`/api/v1/orgs/${orgId}/archive-queue/${requestId}/approve`),
  rejectArchive: (orgId: string, requestId: string, comment: string) =>
    api.post(`/api/v1/orgs/${orgId}/archive-queue/${requestId}/reject`, { comment }),
}

// ── Runs ──────────────────────────────────────────────────────────────────────

export const runsApi = {
  start: (orgId: string, data: object) => api.post(`/api/v1/orgs/${orgId}/runs`, data),
  list: (orgId: string, params?: object) => api.get(`/api/v1/orgs/${orgId}/runs`, { params }),
  get: (orgId: string, runId: string) => api.get(`/api/v1/orgs/${orgId}/runs/${runId}`),
  stop: (orgId: string, runId: string) => api.delete(`/api/v1/orgs/${orgId}/runs/${runId}`),
}

// ── Reports ───────────────────────────────────────────────────────────────────

export const reportsApi = {
  trend: (orgId: string, days = 30) =>
    api.get(`/api/v1/orgs/${orgId}/reports`, { params: { days } }),
  stats: (orgId: string) => api.get(`/api/v1/orgs/${orgId}/reports/stats`),
  get: (runId: string) => api.get(`/api/v1/runs/${runId}/report`),
  attachments: (runId: string) => api.get(`/api/v1/runs/${runId}/attachments`),
}

// ── Pipelines ─────────────────────────────────────────────────────────────────

export const pipelinesApi = {
  list: (orgId: string) => api.get(`/api/v1/orgs/${orgId}/pipelines`),
  create: (orgId: string, data: object) => api.post(`/api/v1/orgs/${orgId}/pipelines`, data),
  update: (orgId: string, pipelineId: string, data: object) =>
    api.put(`/api/v1/orgs/${orgId}/pipelines/${pipelineId}`, data),
  delete: (orgId: string, pipelineId: string) =>
    api.delete(`/api/v1/orgs/${orgId}/pipelines/${pipelineId}`),
  run: (orgId: string, pipelineId: string, data: object) =>
    api.post(`/api/v1/orgs/${orgId}/pipelines/${pipelineId}/run`, data),
}

// ── AI ────────────────────────────────────────────────────────────────────────

export const aiApi = {
  getConfig: (orgId: string) => api.get(`/api/v1/orgs/${orgId}/ai/config`),
  updateConfig: (orgId: string, data: object) =>
    api.put(`/api/v1/orgs/${orgId}/ai/config`, data),
  analyze: (orgId: string, runId: string) =>
    api.post(`/api/v1/orgs/${orgId}/ai/analyze/${runId}`),
  generateTest: (orgId: string, data: object) =>
    api.post(`/api/v1/orgs/${orgId}/ai/generate-test`, data),
  // Streaming chat — returns fetch Response for SSE reading
  chatStream: async (orgId: string, messages: object[], token: string) => {
    return fetch(`${BASE_URL}/api/v1/orgs/${orgId}/ai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ messages }),
    })
  },
}

// ── Notifications ─────────────────────────────────────────────────────────────

export const notificationsApi = {
  list: (params?: object) => api.get('/api/v1/me/notifications', { params }),
  read: (notifId: string) => api.post(`/api/v1/me/notifications/${notifId}/read`),
  readAll: () => api.post('/api/v1/me/notifications/read-all'),
}

// ── SCORM ─────────────────────────────────────────────────────────────────────

export const scormApi = {
  upload: (orgId: string, formData: FormData) =>
    api.post(`/api/v1/orgs/${orgId}/scorm/upload`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }),
  status: (orgId: string, jobId: string) =>
    api.get(`/api/v1/orgs/${orgId}/scorm/status/${jobId}`),
  listSnapshots: (orgId: string, params?: object) =>
    api.get(`/api/v1/orgs/${orgId}/scorm/snapshots`, { params }),
  getSnapshot: (orgId: string, id: string) =>
    api.get(`/api/v1/orgs/${orgId}/scorm/snapshots/${id}`),
  deleteSnapshot: (orgId: string, id: string) =>
    api.delete(`/api/v1/orgs/${orgId}/scorm/snapshots/${id}`),
  listGenerators: (orgId: string) =>
    api.get(`/api/v1/orgs/${orgId}/scorm/generators`),
  generate: (orgId: string, typeKey: string) =>
    `${BASE_URL}/api/v1/orgs/${orgId}/scorm/generate/${typeKey}`, // returns download URL
}

// ── Admin ─────────────────────────────────────────────────────────────────────

export const adminApi = {
  listOrgs: () => api.get('/api/v1/admin/orgs'),
  createOrg: (data: object) => api.post('/api/v1/admin/orgs', data),
  updateOrg: (orgId: string, data: object) => api.put(`/api/v1/admin/orgs/${orgId}`, data),
  joinOrg: (orgId: string) => api.post(`/api/v1/admin/orgs/${orgId}/join`),
  listUsers: () => api.get('/api/v1/admin/users'),
}
