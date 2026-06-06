package api

import (
	"context"
	"net/http"

	"github.com/apyhub/scout/internal/ai"
	"github.com/apyhub/scout/internal/auth"
	"github.com/apyhub/scout/internal/config"
	"github.com/apyhub/scout/internal/gitlab"
	"github.com/apyhub/scout/internal/notifications"
	"github.com/apyhub/scout/internal/runner"
	"github.com/apyhub/scout/internal/scorm"
	"github.com/apyhub/scout/internal/storage"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Services bundles all dependencies passed from main.go into the API layer.
type Services struct {
	Config        *config.Config
	DB            *pgxpool.Pool
	Auth          *auth.Service
	Storage       storage.Storage
	Runner        *runner.Service
	AI            *ai.Service
	SCORM         *scorm.Service
	Notifications *notifications.Service
	GitLab        *gitlab.Service
}

// RegisterRoutes wires all HTTP handlers to their routes and returns the root mux.
// ctx scopes long-lived middleware goroutines (e.g. the rate-limit cleanup loop)
// to the server lifetime — cancel it during graceful shutdown.
func RegisterRoutes(ctx context.Context, svc Services) http.Handler {
	mux := http.NewServeMux()

	// Apply global middleware stack: CORS → rate limit → request logging
	mid := newMiddlewareChain(ctx, svc.Config)

	// ── Health (public, no auth) ──────────────────────────────────────────
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	// ── Auth (public) ─────────────────────────────────────────────────────
	authH := newAuthHandler(svc)
	mux.HandleFunc("GET /api/v1/auth/google", authH.RedirectToGoogle)
	mux.HandleFunc("GET /api/v1/auth/google/callback", authH.Callback)
	mux.HandleFunc("POST /api/v1/auth/logout", authH.Logout)
	mux.HandleFunc("GET /api/v1/auth/me", chain(authH.Me, svc.Auth.Authenticate))

	// ── GitLab OAuth callback (public) + org-scoped routes ────────────────
	gitLabH := newGitLabHandler(svc)
	mux.HandleFunc("GET /api/v1/auth/gitlab/callback", gitLabH.OAuthCallback)
	mux.HandleFunc("GET /api/v1/orgs/{orgId}/integrations/gitlab", chain(gitLabH.ListIntegrations,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember))
	mux.HandleFunc("GET /api/v1/orgs/{orgId}/integrations/gitlab/connect-url", chain(gitLabH.ConnectURL,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember))
	mux.HandleFunc("GET /api/v1/orgs/{orgId}/integrations/gitlab/{integrationId}/repos", chain(gitLabH.ListRepos,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember))
	mux.HandleFunc("GET /api/v1/orgs/{orgId}/integrations/gitlab/{integrationId}/dirs", chain(gitLabH.ListDirs,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember))
	mux.HandleFunc("PUT /api/v1/orgs/{orgId}/integrations/gitlab/{integrationId}", chain(gitLabH.UpdateIntegration,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember))
	mux.HandleFunc("DELETE /api/v1/orgs/{orgId}/integrations/gitlab/{integrationId}", chain(gitLabH.DeleteIntegration,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember))
	mux.HandleFunc("POST /api/v1/orgs/{orgId}/products/{productId}/gitlab/sync", chain(gitLabH.SyncProduct,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember))

	// ── Platform admin ────────────────────────────────────────────────────
	adminH := newAdminHandler(svc)
	mux.HandleFunc("GET /api/v1/admin/orgs", chain(adminH.ListOrgs,
		svc.Auth.Authenticate, svc.Auth.RequirePlatformAdmin))
	mux.HandleFunc("POST /api/v1/admin/orgs", chain(adminH.CreateOrg,
		svc.Auth.Authenticate, svc.Auth.RequirePlatformAdmin))
	mux.HandleFunc("PUT /api/v1/admin/orgs/{orgId}", chain(adminH.UpdateOrg,
		svc.Auth.Authenticate, svc.Auth.RequirePlatformAdmin))
	mux.HandleFunc("POST /api/v1/admin/orgs/{orgId}/join", chain(adminH.JoinOrg,
		svc.Auth.Authenticate, svc.Auth.RequirePlatformAdmin))
	mux.HandleFunc("GET /api/v1/admin/users", chain(adminH.ListUsers,
		svc.Auth.Authenticate, svc.Auth.RequirePlatformAdmin))
	mux.HandleFunc("GET /api/v1/admin/orgs/{orgId}/members", chain(adminH.ListOrgMembers,
		svc.Auth.Authenticate, svc.Auth.RequirePlatformAdmin))
	mux.HandleFunc("POST /api/v1/admin/orgs/{orgId}/members", chain(adminH.AddOrgMember,
		svc.Auth.Authenticate, svc.Auth.RequirePlatformAdmin))
	mux.HandleFunc("DELETE /api/v1/admin/orgs/{orgId}/members/{userId}", chain(adminH.RemoveOrgMember,
		svc.Auth.Authenticate, svc.Auth.RequirePlatformAdmin))

	// ── Organizations ─────────────────────────────────────────────────────
	orgH := newOrgHandler(svc)
	mux.HandleFunc("GET /api/v1/orgs", chain(orgH.ListMyOrgs, svc.Auth.Authenticate))
	mux.HandleFunc("GET /api/v1/orgs/{orgId}", chain(orgH.GetOrg,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember))

	// ── Members ───────────────────────────────────────────────────────────
	memberH := newMemberHandler(svc)
	mux.HandleFunc("GET /api/v1/orgs/{orgId}/members", chain(memberH.List,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember))
	mux.HandleFunc("POST /api/v1/orgs/{orgId}/members", chain(memberH.Add,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember, svc.Auth.RequireOrgAdmin))
	mux.HandleFunc("PUT /api/v1/orgs/{orgId}/members/{memberId}", chain(memberH.Update,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember, svc.Auth.RequireOrgAdmin))
	mux.HandleFunc("DELETE /api/v1/orgs/{orgId}/members/{memberId}", chain(memberH.Remove,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember, svc.Auth.RequireOrgAdmin))

	// ── Products ──────────────────────────────────────────────────────────
	productH := newProductHandler(svc)
	mux.HandleFunc("GET /api/v1/orgs/{orgId}/products", chain(productH.List,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember))
	mux.HandleFunc("POST /api/v1/orgs/{orgId}/products", chain(productH.Create,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember, svc.Auth.RequireOrgAdmin))
	mux.HandleFunc("PUT /api/v1/orgs/{orgId}/products/{productId}", chain(productH.Update,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember, svc.Auth.RequireOrgAdmin))
	mux.HandleFunc("DELETE /api/v1/orgs/{orgId}/products/{productId}", chain(productH.Delete,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember, svc.Auth.RequireOrgAdmin))
	mux.HandleFunc("GET /api/v1/orgs/{orgId}/products/{productId}/tests", chain(productH.Tests,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember))

	// ── Sub-projects ──────────────────────────────────────────────────────
	spH := newSubProjectHandler(svc)
	mux.HandleFunc("GET /api/v1/orgs/{orgId}/products/{productId}/subprojects", chain(spH.List,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember))
	mux.HandleFunc("POST /api/v1/orgs/{orgId}/products/{productId}/subprojects", chain(spH.Create,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember, svc.Auth.RequireOrgAdmin))
	mux.HandleFunc("PUT /api/v1/orgs/{orgId}/products/{productId}/subprojects/{spId}", chain(spH.Update,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember, svc.Auth.RequireOrgAdmin))
	mux.HandleFunc("DELETE /api/v1/orgs/{orgId}/products/{productId}/subprojects/{spId}", chain(spH.Delete,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember, svc.Auth.RequireOrgAdmin))
	mux.HandleFunc("GET /api/v1/subprojects/{spId}/root-folder", chain(spH.RootFolder,
		svc.Auth.Authenticate))

	// ── Environments ──────────────────────────────────────────────────────
	envH := newEnvironmentHandler(svc)
	mux.HandleFunc("GET /api/v1/orgs/{orgId}/environments", chain(envH.List,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember))
	mux.HandleFunc("POST /api/v1/orgs/{orgId}/environments", chain(envH.Create,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember, svc.Auth.RequireOrgAdmin))
	mux.HandleFunc("PUT /api/v1/orgs/{orgId}/environments/{envId}", chain(envH.Update,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember, svc.Auth.RequireOrgAdmin))
	mux.HandleFunc("DELETE /api/v1/orgs/{orgId}/environments/{envId}", chain(envH.Delete,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember, svc.Auth.RequireOrgAdmin))
	mux.HandleFunc("GET /api/v1/subprojects/{spId}/env-urls", chain(envH.ListEnvURLs,
		svc.Auth.Authenticate))
	mux.HandleFunc("PUT /api/v1/subprojects/{spId}/env-urls", chain(envH.SetEnvURL,
		svc.Auth.Authenticate))

	// ── Folders ───────────────────────────────────────────────────────────
	folderH := newFolderHandler(svc)
	mux.HandleFunc("GET /api/v1/subprojects/{spId}/folders", chain(folderH.Tree,
		svc.Auth.Authenticate))
	mux.HandleFunc("POST /api/v1/subprojects/{spId}/folders", chain(folderH.Create,
		svc.Auth.Authenticate))
	mux.HandleFunc("PUT /api/v1/folders/{folderId}", chain(folderH.Rename,
		svc.Auth.Authenticate))
	mux.HandleFunc("DELETE /api/v1/folders/{folderId}", chain(folderH.Delete,
		svc.Auth.Authenticate))

	// ── Tests ─────────────────────────────────────────────────────────────
	testH := newTestHandler(svc)
	mux.HandleFunc("GET /api/v1/folders/{folderId}/tests", chain(testH.List,
		svc.Auth.Authenticate))
	mux.HandleFunc("POST /api/v1/folders/{folderId}/tests", chain(testH.Upload,
		svc.Auth.Authenticate))
	mux.HandleFunc("GET /api/v1/tests/{testId}", chain(testH.Get,
		svc.Auth.Authenticate))
	mux.HandleFunc("PUT /api/v1/tests/{testId}", chain(testH.Update,
		svc.Auth.Authenticate))
	mux.HandleFunc("GET /api/v1/tests/{testId}/versions", chain(testH.Versions,
		svc.Auth.Authenticate))
	mux.HandleFunc("POST /api/v1/tests/{testId}/validate", chain(testH.Validate,
		svc.Auth.Authenticate))
	mux.HandleFunc("POST /api/v1/tests/{testId}/archive-request", chain(testH.ArchiveRequest,
		svc.Auth.Authenticate))

	// ── Runs ──────────────────────────────────────────────────────────────
	runH := newRunHandler(svc)
	mux.HandleFunc("POST /api/v1/orgs/{orgId}/runs", chain(runH.Start,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember))
	mux.HandleFunc("GET /api/v1/orgs/{orgId}/runs", chain(runH.List,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember))
	mux.HandleFunc("GET /api/v1/orgs/{orgId}/runs/{runId}", chain(runH.Get,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember))
	mux.HandleFunc("DELETE /api/v1/orgs/{orgId}/runs/{runId}", chain(runH.Stop,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember))
	mux.HandleFunc("GET /api/v1/orgs/{orgId}/runs/{runId}/stream", runH.Stream) // WS — no JWT middleware (token in query param)

	// ── Reports ───────────────────────────────────────────────────────────
	reportH := newReportHandler(svc)
	mux.HandleFunc("GET /api/v1/orgs/{orgId}/reports", chain(reportH.Trend,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember))
	mux.HandleFunc("GET /api/v1/orgs/{orgId}/reports/stats", chain(reportH.Stats,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember))
	mux.HandleFunc("GET /api/v1/runs/{runId}/report", chain(reportH.Get,
		svc.Auth.Authenticate))
	mux.HandleFunc("GET /api/v1/runs/{runId}/attachments", chain(reportH.Attachments,
		svc.Auth.Authenticate))

	// ── Flows (cross-platform test chains) ───────────────────────────────────────
	flowH := newFlowHandler(svc)
	mux.HandleFunc("GET /api/v1/orgs/{orgId}/flows", chain(flowH.List,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember))
	mux.HandleFunc("POST /api/v1/orgs/{orgId}/flows", chain(flowH.Create,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember))
	mux.HandleFunc("GET /api/v1/orgs/{orgId}/flows/runs", chain(flowH.ListRuns,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember))
	mux.HandleFunc("GET /api/v1/orgs/{orgId}/flows/runs/{flowRunId}", chain(flowH.GetRun,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember))
	mux.HandleFunc("GET /api/v1/orgs/{orgId}/flows/{flowId}", chain(flowH.Get,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember))
	mux.HandleFunc("PUT /api/v1/orgs/{orgId}/flows/{flowId}", chain(flowH.Update,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember))
	mux.HandleFunc("DELETE /api/v1/orgs/{orgId}/flows/{flowId}", chain(flowH.Delete,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember))
	mux.HandleFunc("POST /api/v1/orgs/{orgId}/flows/{flowId}/run", chain(flowH.RunFlow,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember))
	mux.HandleFunc("POST /api/v1/orgs/{orgId}/flows/{flowId}/steps", chain(flowH.AddStep,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember))
	mux.HandleFunc("PUT /api/v1/orgs/{orgId}/flows/{flowId}/steps/{stepId}", chain(flowH.UpdateStep,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember))
	mux.HandleFunc("DELETE /api/v1/orgs/{orgId}/flows/{flowId}/steps/{stepId}", chain(flowH.DeleteStep,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember))
	mux.HandleFunc("POST /api/v1/orgs/{orgId}/flows/{flowId}/steps/reorder", chain(flowH.ReorderSteps,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember))

	// ── Pipelines ─────────────────────────────────────────────────────────
	pipeH := newPipelineHandler(svc)
	mux.HandleFunc("GET /api/v1/orgs/{orgId}/pipelines", chain(pipeH.List,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember))
	mux.HandleFunc("POST /api/v1/orgs/{orgId}/pipelines", chain(pipeH.Create,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember))
	mux.HandleFunc("PUT /api/v1/orgs/{orgId}/pipelines/{pipelineId}", chain(pipeH.Update,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember))
	mux.HandleFunc("DELETE /api/v1/orgs/{orgId}/pipelines/{pipelineId}", chain(pipeH.Delete,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember))
	mux.HandleFunc("POST /api/v1/orgs/{orgId}/pipelines/{pipelineId}/run", chain(pipeH.Run,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember))

	// ── Archive queue ─────────────────────────────────────────────────────
	mux.HandleFunc("GET /api/v1/orgs/{orgId}/archive-queue", chain(testH.ListArchiveQueue,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember, svc.Auth.RequireOrgAdmin))
	mux.HandleFunc("POST /api/v1/orgs/{orgId}/archive-queue/{requestId}/approve", chain(testH.ApproveArchive,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember, svc.Auth.RequireOrgAdmin))
	mux.HandleFunc("POST /api/v1/orgs/{orgId}/archive-queue/{requestId}/reject", chain(testH.RejectArchive,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember, svc.Auth.RequireOrgAdmin))

	// ── AI ────────────────────────────────────────────────────────────────
	aiH := newAIHandler(svc)
	mux.HandleFunc("GET /api/v1/orgs/{orgId}/ai/config", chain(aiH.GetConfig,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember))
	mux.HandleFunc("PUT /api/v1/orgs/{orgId}/ai/config", chain(aiH.UpdateConfig,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember, svc.Auth.RequireOrgAdmin))
	mux.HandleFunc("POST /api/v1/orgs/{orgId}/ai/chat", chain(aiH.Chat,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember))
	mux.HandleFunc("POST /api/v1/orgs/{orgId}/ai/analyze/{runId}", chain(aiH.Analyze,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember))
	mux.HandleFunc("POST /api/v1/orgs/{orgId}/ai/generate-test", chain(aiH.GenerateTest,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember))

	// ── Notifications ─────────────────────────────────────────────────────
	notifH := newNotificationHandler(svc)
	mux.HandleFunc("GET /api/v1/me/notifications", chain(notifH.List,
		svc.Auth.Authenticate))
	mux.HandleFunc("POST /api/v1/me/notifications/read-all", chain(notifH.ReadAll,
		svc.Auth.Authenticate))
	mux.HandleFunc("POST /api/v1/me/notifications/{notifId}/read", chain(notifH.Read,
		svc.Auth.Authenticate))

	// ── SCORM ─────────────────────────────────────────────────────────────
	mux.HandleFunc("POST /api/v1/orgs/{orgId}/scorm/upload", chain(svc.SCORM.HandleUpload,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember))
	mux.HandleFunc("GET /api/v1/orgs/{orgId}/scorm/status/{jobId}", chain(svc.SCORM.HandleStatus,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember))
	mux.HandleFunc("GET /api/v1/orgs/{orgId}/scorm/snapshots", chain(svc.SCORM.HandleListSnapshots,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember))
	mux.HandleFunc("GET /api/v1/orgs/{orgId}/scorm/snapshots/{id}", chain(svc.SCORM.HandleGetSnapshot,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember))
	mux.HandleFunc("DELETE /api/v1/orgs/{orgId}/scorm/snapshots/{id}", chain(svc.SCORM.HandleDeleteSnapshot,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember))
	mux.HandleFunc("GET /api/v1/orgs/{orgId}/scorm/generators", chain(svc.SCORM.HandleListGenerators,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember))
	mux.HandleFunc("GET /api/v1/orgs/{orgId}/scorm/generate/{typeKey}", chain(svc.SCORM.HandleGenerate,
		svc.Auth.Authenticate, svc.Auth.RequireOrgMember))

	// ── Static file serving (local storage) ──────────────────────────────
	if svc.Config.StorageDriver == "local" {
		storageH := newStorageHandler(svc)
		mux.HandleFunc("GET /api/v1/storage/{key...}", chain(storageH.Serve,
			svc.Auth.Authenticate))
	}

	return mid.wrap(mux)
}

// chain applies middleware in order: the last middleware in the list wraps outermost.
// Usage: chain(handler, m1, m2) → m1(m2(handler))
func chain(h http.HandlerFunc, middlewares ...func(http.Handler) http.Handler) http.HandlerFunc {
	handler := http.Handler(h)
	for i := len(middlewares) - 1; i >= 0; i-- {
		handler = middlewares[i](handler)
	}
	return handler.ServeHTTP
}
