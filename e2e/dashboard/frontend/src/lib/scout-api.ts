import { api, API_BASE_URL } from "@/lib/api"
import { clearToken, getToken } from "@/lib/auth"

export type ScoutUser = {
  id: string
  email: string
  name: string
  avatar_url: string
  created_at: string
}

export type ScoutOrg = {
  id: string
  name: string
  slug: string
  theme: Record<string, string>
  is_active: boolean
  created_at: string
}

export type MeResponse = {
  user: ScoutUser
  orgs: ScoutOrg[]
  is_platform_admin: boolean
}

export type ChatMessage = {
  role: "user" | "assistant"
  content: string
}

export async function streamChat(
  orgId: string,
  messages: ChatMessage[],
  handlers: {
    onToken: (full: string) => void
    onDone: (full: string) => void
    onError?: (message: string) => void
  },
  signal: AbortSignal,
) {
  const token = getToken()
  const res = await fetch(`${API_BASE_URL}/api/v1/orgs/${orgId}/ai/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ messages }),
    signal,
  })

  if (res.status === 401) {
    clearToken()
    window.location.href = "/login"
    throw new Error("Unauthorized")
  }
  if (!res.ok || !res.body) {
    throw new Error(`Chat stream failed (${res.status})`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let accumulated = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue
      const chunk = line.slice(6)
      if (chunk === "[DONE]") {
        handlers.onDone(accumulated)
        return
      }
      if (chunk.startsWith("[ERROR]")) {
        const msg = chunk.slice(8)
        handlers.onError?.(msg)
        accumulated += `\n\n⚠️  ${msg}`
        handlers.onToken(accumulated)
        handlers.onDone(accumulated)
        return
      }
      accumulated += chunk
      handlers.onToken(accumulated)
    }
  }
  handlers.onDone(accumulated)
}

export type RunStatus = "queued" | "running" | "done" | "failed" | "stopped"

export type RecentRun = {
  id: string
  label: string
  status: RunStatus
  created_at: string
}

export type OverviewStats = {
  total_runs: number
  total_passed: number
  total_failed: number
  avg_pass_rate: number
  active_runs: number
  queued_runs: number
}

export type TrendPoint = {
  date: string
  passed: number
  failed: number
}

export const authApi = {
  me: () => api.get<MeResponse>("/auth/me").then((r) => r.data),
}

export type OrgInput = {
  name: string
  slug: string
  is_active?: boolean
}

export type OrgUpdateInput = {
  name: string
  slug: string
  is_active: boolean
  theme?: Record<string, string>
}

export const orgsApi = {
  list: (opts?: { includeInactive?: boolean }) =>
    api
      .get<{ orgs: ScoutOrg[] }>("/orgs", {
        params: opts?.includeInactive ? { include_inactive: "true" } : undefined,
      })
      .then((r) => r.data.orgs),
  create: (body: OrgInput) =>
    api.post<ScoutOrg>("/orgs", body).then((r) => r.data),
  update: (orgId: string, body: OrgUpdateInput) =>
    api
      .put<ScoutOrg>(`/admin/orgs/${orgId}`, {
        theme: {},
        ...body,
      })
      .then((r) => r.data),
}

export type ProductGitlabLink = {
  integration_id: string
  repo_id: number
  repo_name: string
  repo_url: string
  branch: string
  repo_path: string
}

export type Product = {
  id: string
  name: string
  slug: string
  description: string
  icon: string
  created_at: string
  gitlab?: ProductGitlabLink | null
}

export type ProductInput = {
  name: string
  slug: string
  description?: string
  icon?: string
  gitlab?: ProductGitlabLink | null
}

export type ProductTest = {
  id: string
  name: string
  file_name: string
  folder_path: string
  is_archived: boolean
  version: number
  created_at: string
  updated_at: string
}

export const productsApi = {
  list: (orgId: string) =>
    api
      .get<{ products: Product[] }>(`/orgs/${orgId}/products`)
      .then((r) => r.data.products),
  create: (orgId: string, body: ProductInput) =>
    api.post<Product>(`/orgs/${orgId}/products`, body).then((r) => r.data),
  update: (orgId: string, productId: string, body: Partial<ProductInput>) =>
    api
      .put<Product>(`/orgs/${orgId}/products/${productId}`, body)
      .then((r) => r.data),
  remove: (orgId: string, productId: string) =>
    api.delete(`/orgs/${orgId}/products/${productId}`),
  tests: (orgId: string, productId: string) =>
    api
      .get<{ tests: ProductTest[] }>(`/orgs/${orgId}/products/${productId}/tests`)
      .then((r) => r.data.tests),
}

export type SubProject = {
  id: string
  name: string
  slug: string
  description: string
  created_at: string
}

export type SubProjectInput = {
  name: string
  slug: string
  description?: string
}

export const subProjectsApi = {
  list: (orgId: string, productId: string) =>
    api
      .get<{ sub_projects: SubProject[] }>(
        `/orgs/${orgId}/products/${productId}/subprojects`,
      )
      .then((r) => r.data.sub_projects),
  create: (orgId: string, productId: string, body: SubProjectInput) =>
    api
      .post<SubProject>(
        `/orgs/${orgId}/products/${productId}/subprojects`,
        body,
      )
      .then((r) => r.data),
  update: (
    orgId: string,
    productId: string,
    spId: string,
    body: Partial<SubProjectInput>,
  ) =>
    api
      .put<SubProject>(
        `/orgs/${orgId}/products/${productId}/subprojects/${spId}`,
        body,
      )
      .then((r) => r.data),
  remove: (orgId: string, productId: string, spId: string) =>
    api.delete(`/orgs/${orgId}/products/${productId}/subprojects/${spId}`),
  rootFolder: (spId: string) =>
    api
      .get<{ folder_id: string }>(`/subprojects/${spId}/root-folder`)
      .then((r) => r.data.folder_id),
}

export type TestCase = {
  id: string
  folder_id: string
  name: string
  description: string
  file_name: string
  file_content: string
  bundled_content?: string
  is_archived: boolean
  version: number
  created_at: string
  updated_at: string
}

export type Folder = {
  id: string
  sub_project_id: string
  parent_id: string | null
  name: string
  path: string
  created_at: string
  children?: Folder[]
  test_cases?: TestCase[]
}

export const foldersApi = {
  tree: (spId: string) =>
    api
      .get<{ folders: Folder[] }>(`/subprojects/${spId}/folders`)
      .then((r) => r.data.folders),
  create: (spId: string, body: { name: string; parent_id?: string | null }) =>
    api
      .post<Folder>(`/subprojects/${spId}/folders`, body)
      .then((r) => r.data),
  rename: (folderId: string, body: { name: string }) =>
    api.put<Folder>(`/folders/${folderId}`, body).then((r) => r.data),
  remove: (folderId: string) => api.delete(`/folders/${folderId}`),
  listTests: (folderId: string) =>
    api
      .get<{ tests: TestCase[] }>(`/folders/${folderId}/tests`)
      .then((r) => r.data.tests),
}

export const testsApi = {
  get: (testId: string) =>
    api.get<TestCase>(`/tests/${testId}`).then((r) => r.data),
  update: (testId: string, body: Partial<Pick<TestCase, "name" | "description" | "file_content">>) =>
    api.put<TestCase>(`/tests/${testId}`, body).then((r) => r.data),
  versions: (testId: string) =>
    api
      .get<{ versions: Array<{ id: string; version: number; file_content: string; changed_at: string }> }>(
        `/tests/${testId}/versions`,
      )
      .then((r) => r.data.versions),
}

export function slugify(str: string) {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

export type GitlabIntegration = {
  id: string
  org_id: string
  subproject_id: string | null
  gitlab_username: string
  gitlab_avatar: string
  repo_id: number
  repo_name: string
  repo_url: string
  branch: string
  repo_path: string
  last_synced_at: string | null
  created_at: string
}

export type GitlabSyncResult = {
  added: number
  updated: number
  skipped: number
  deleted: number
  skip_reasons?: string[]
}

export type GitlabRepo = {
  id: number
  name: string
  path_with_namespace: string
  web_url: string
  default_branch: string
}

export type GitlabIntegrationUpdate = {
  subproject_id?: string | null
  repo_id?: number
  repo_name?: string
  repo_url?: string
  branch?: string
  repo_path?: string
}

export const gitlabApi = {
  list: (orgId: string) =>
    api
      .get<{ integrations: GitlabIntegration[] }>(
        `/orgs/${orgId}/integrations/gitlab`,
      )
      .then((r) => r.data.integrations),
  listRepos: (orgId: string, integrationId: string) =>
    api
      .get<{ repos: GitlabRepo[] }>(
        `/orgs/${orgId}/integrations/gitlab/${integrationId}/repos`,
      )
      .then((r) => r.data.repos),
  listDirs: (
    orgId: string,
    integrationId: string,
    opts?: { repoId?: number; branch?: string },
  ) =>
    api
      .get<{ dirs: string[] }>(
        `/orgs/${orgId}/integrations/gitlab/${integrationId}/dirs`,
        {
          params: {
            ...(opts?.repoId ? { repo_id: opts.repoId } : {}),
            ...(opts?.branch ? { branch: opts.branch } : {}),
          },
        },
      )
      .then((r) => r.data.dirs),
  update: (
    orgId: string,
    integrationId: string,
    body: GitlabIntegrationUpdate,
  ) =>
    api
      .put<GitlabIntegration>(
        `/orgs/${orgId}/integrations/gitlab/${integrationId}`,
        body,
      )
      .then((r) => r.data),
  syncProduct: (orgId: string, productId: string) =>
    api
      .post<GitlabSyncResult>(
        `/orgs/${orgId}/products/${productId}/gitlab/sync`,
      )
      .then((r) => r.data),
  disconnect: (orgId: string, integrationId: string) =>
    api.delete(`/orgs/${orgId}/integrations/gitlab/${integrationId}`),
  startConnect: (orgId: string, returnTo: string) =>
    api
      .get<{ url: string }>(
        `/orgs/${orgId}/integrations/gitlab/connect-url`,
        { params: { return_to: returnTo } },
      )
      .then((r) => r.data.url),
}

export const AI_MODELS = [
  "llama-3.3-70b-versatile",
  "llama-3.1-70b-versatile",
  "llama-3.1-8b-instant",
  "mixtral-8x7b-32768",
] as const

export type AiModel = (typeof AI_MODELS)[number]

export type AiConfig = {
  system_prompt: string
  model: string
  temperature: number
  max_tokens: number
  rag_enabled: boolean
}

export const AI_CONFIG_DEFAULTS: AiConfig = {
  system_prompt: "",
  model: "llama-3.3-70b-versatile",
  temperature: 0.7,
  max_tokens: 2048,
  rag_enabled: true,
}

export const aiConfigApi = {
  get: (orgId: string) =>
    api
      .get<Partial<AiConfig>>(`/orgs/${orgId}/ai/config`)
      .then((r): AiConfig => ({ ...AI_CONFIG_DEFAULTS, ...r.data })),
  update: (orgId: string, body: AiConfig) =>
    api.put<AiConfig>(`/orgs/${orgId}/ai/config`, body).then((r) => r.data),
}

export type Notification = {
  id: string
  type: string
  title: string
  message: string
  read: boolean
  created_at: string
  run_id?: string
}

export type NotificationsListResponse = {
  notifications: Notification[]
  unread_count: number
}

export const notificationsApi = {
  list: (params: { limit: number; offset?: number }) =>
    api
      .get<NotificationsListResponse>("/me/notifications", { params })
      .then((r) => r.data),
  read: (id: string) => api.post(`/me/notifications/${id}/read`),
  readAll: () => api.post("/me/notifications/read-all"),
}

export type ArchiveRequestStatus = "pending" | "approved" | "rejected"

export type ArchiveRequest = {
  id: string
  test_case_id: string
  test_case_name: string
  reason: string
  requester_name: string
  status: ArchiveRequestStatus
  created_at: string
}

export const archiveApi = {
  list: (orgId: string) =>
    api
      .get<{ requests: ArchiveRequest[] }>(`/orgs/${orgId}/archive-queue`)
      .then((r) => r.data.requests),
  approve: (orgId: string, requestId: string) =>
    api.post(`/orgs/${orgId}/archive-queue/${requestId}/approve`),
  reject: (orgId: string, requestId: string, comment: string) =>
    api.post(`/orgs/${orgId}/archive-queue/${requestId}/reject`, { comment }),
  submitRequest: (testId: string, reason: string) =>
    api.post(`/tests/${testId}/archive-request`, { reason }),
}

export type MemberRole = "admin" | "member"

export type OrgMember = {
  id: string
  user_id: string
  role: MemberRole
  user_name: string
  user_email: string
  avatar_url: string
}

export const membersApi = {
  list: (orgId: string) =>
    api
      .get<{ members: OrgMember[] }>(`/orgs/${orgId}/members`)
      .then((r) => r.data.members),
  add: (orgId: string, body: { email: string; role: MemberRole }) =>
    api.post<OrgMember>(`/orgs/${orgId}/members`, body).then((r) => r.data),
  update: (orgId: string, memberId: string, body: { role: MemberRole }) =>
    api
      .put<OrgMember>(`/orgs/${orgId}/members/${memberId}`, body)
      .then((r) => r.data),
  remove: (orgId: string, memberId: string) =>
    api.delete(`/orgs/${orgId}/members/${memberId}`),
}

export const adminUsersApi = {
  list: () =>
    api.get<{ users: ScoutUser[] }>("/admin/users").then((r) => r.data.users),
}

export const adminOrgMembersApi = {
  list: (orgId: string) =>
    api
      .get<{ members: OrgMember[] }>(`/admin/orgs/${orgId}/members`)
      .then((r) => r.data.members),
  add: (orgId: string, body: { user_id: string; role: MemberRole }) =>
    api.post<OrgMember>(`/admin/orgs/${orgId}/members`, body).then((r) => r.data),
  remove: (orgId: string, userId: string) =>
    api.delete(`/admin/orgs/${orgId}/members/${userId}`),
}

export type Environment = {
  id: string
  name: string
  label: string
  base_url: string
  username: string
  password: string
}

export type EnvironmentInput = {
  name: string
  label?: string
  base_url?: string
  username?: string
  password?: string
}

export const environmentsApi = {
  list: (orgId: string) =>
    api
      .get<{ environments: Environment[] }>(`/orgs/${orgId}/environments`)
      .then((r) => r.data.environments),
  create: (orgId: string, body: EnvironmentInput) =>
    api
      .post<Environment>(`/orgs/${orgId}/environments`, body)
      .then((r) => r.data),
  update: (orgId: string, envId: string, body: EnvironmentInput) =>
    api
      .put<Environment>(`/orgs/${orgId}/environments/${envId}`, body)
      .then((r) => r.data),
  remove: (orgId: string, envId: string) =>
    api.delete(`/orgs/${orgId}/environments/${envId}`),
}

export type PipelineTargetType = "subproject" | "folder" | "test" | "product"

export type PipelineStep = {
  id: string
  target_type: PipelineTargetType
  target_id: string
  target_label: string
  order: number
}

export type PipelineStepInput = {
  target_type: PipelineTargetType
  target_id: string
  order: number
}

export type Pipeline = {
  id: string
  name: string
  description: string | null
  created_at: string
  steps: PipelineStep[]
}

export const pipelinesApi = {
  list: (orgId: string) =>
    api
      .get<{ pipelines: Pipeline[] }>(`/orgs/${orgId}/pipelines`)
      .then((r) => r.data.pipelines),
  create: (
    orgId: string,
    body: { name: string; description: string | null; steps: PipelineStepInput[] },
  ) =>
    api
      .post<Pipeline>(`/orgs/${orgId}/pipelines`, body)
      .then((r) => r.data),
  update: (
    orgId: string,
    pipelineId: string,
    body: {
      name: string
      description: string | null
      steps: PipelineStepInput[]
    },
  ) =>
    api
      .put<Pipeline>(`/orgs/${orgId}/pipelines/${pipelineId}`, body)
      .then((r) => r.data),
  remove: (orgId: string, pipelineId: string) =>
    api.delete(`/orgs/${orgId}/pipelines/${pipelineId}`),
}

export type Run = {
  id: string
  label: string
  status: RunStatus
  created_at: string
  started_at: string | null
  completed_at: string | null
  environment: { name: string } | null
}

export type RunsListResponse = {
  runs: Run[]
  active: number
  total: number
}

export type StartRunBody = {
  target_type: "test_case" | "folder" | "pipeline"
  target_ids: string[]
  environment_id?: string
  credentials?: Record<string, string>
  label?: string
}

export type StartRunResponse = {
  run_id: string
  status: string
  label: string
}

export type RunDetail = {
  id: string
  org_id: string
  pipeline_id: string | null
  environment_id: string | null
  triggered_by: string | null
  status: RunStatus
  label: string
  error_message?: string
  started_at: string | null
  completed_at: string | null
  created_at: string
}

export type RunItem = {
  id: string
  run_id: string
  test_case_id: string | null
  pipeline_step: number | null
  status: string
  duration_ms: number | null
  error_message: string
  error_stack: string
  retry_count: number
  started_at: string | null
  completed_at: string | null
  test_case_name?: string
}

export type RunReport = {
  id: string
  run_id: string
  passed: number
  failed: number
  skipped: number
  timed_out: number
  total: number
  duration_ms: number | null
  report_url: string
  console_errors: number
  api_errors: number
  failed_requests: number
  page_errors: number
  created_at: string
}

export type RunDetailResponse = {
  run: RunDetail
  items: RunItem[]
  report: RunReport | null
}

export function runStreamUrl(orgId: string, runId: string) {
  const token = getToken() ?? ""
  const wsBase = API_BASE_URL.replace(/^http/, "ws")
  return `${wsBase}/api/v1/orgs/${orgId}/runs/${runId}/stream?token=${encodeURIComponent(token)}`
}

export const runsApi = {
  list: (
    orgId: string,
    params: { status?: RunStatus; limit: number; offset: number },
  ) =>
    api
      .get<RunsListResponse>(`/orgs/${orgId}/runs`, { params })
      .then((r) => r.data),
  get: (orgId: string, runId: string) =>
    api
      .get<RunDetailResponse>(`/orgs/${orgId}/runs/${runId}`)
      .then((r) => r.data),
  start: (orgId: string, body: StartRunBody) =>
    api
      .post<StartRunResponse>(`/orgs/${orgId}/runs`, body)
      .then((r) => r.data),
  stop: (orgId: string, runId: string) =>
    api.delete(`/orgs/${orgId}/runs/${runId}`),
}

export const overviewApi = {
  stats: (orgId: string) =>
    api
      .get<OverviewStats>(`/orgs/${orgId}/reports/stats`)
      .then((r) => r.data),
  trend: (orgId: string, days = 14) =>
    api
      .get<{ trend: TrendPoint[] }>(`/orgs/${orgId}/reports`, {
        params: { days },
      })
      .then((r) => r.data.trend),
  recentRuns: (orgId: string, limit = 8) =>
    api
      .get<{ runs: RecentRun[] }>(`/orgs/${orgId}/runs`, {
        params: { limit },
      })
      .then((r) => r.data.runs),
}
