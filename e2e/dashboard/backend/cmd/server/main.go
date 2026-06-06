package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/apyhub/scout/internal/ai"
	"github.com/apyhub/scout/internal/api"
	"github.com/apyhub/scout/internal/auth"
	"github.com/apyhub/scout/internal/config"
	"github.com/apyhub/scout/internal/db"
	"github.com/apyhub/scout/internal/db/queries"
	"github.com/apyhub/scout/internal/gitlab"
	"github.com/apyhub/scout/internal/notifications"
	"github.com/apyhub/scout/internal/runner"
	"github.com/apyhub/scout/internal/scheduler"
	"github.com/apyhub/scout/internal/scorm"
	"github.com/apyhub/scout/internal/storage"
	"github.com/apyhub/scout/internal/youtrack"
)

func main() {
	// ── 1. Load configuration ──────────────────────────────────────────────
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("[scout] config error: %v", err)
	}
	log.Printf("[scout] starting in %s mode on port %s", cfg.Environment, cfg.Port)

	// ── 2. Connect to database ─────────────────────────────────────────────
	pool, err := db.Connect(context.Background(), cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("[scout] db connect error: %v", err)
	}
	defer pool.Close()
	log.Println("[scout] database connected")

	// ── 3. Run embedded SQL migrations ────────────────────────────────────
	if err := db.RunMigrations(context.Background(), pool); err != nil {
		log.Fatalf("[scout] migration error: %v", err)
	}
	log.Println("[scout] migrations applied")

	// ── 3b. Seed platform admins from config ─────────────────────────────
	if len(cfg.PlatformAdminEmails) > 0 {
		userQ := queries.NewUserQueries(pool)
		if err := userQ.SeedPlatformAdmins(context.Background(), cfg.PlatformAdminEmails); err != nil {
			log.Fatalf("[scout] platform admin seed error: %v", err)
		}
		log.Printf("[scout] platform admins seeded: %v", cfg.PlatformAdminEmails)
	}

	// ── 4. Initialize storage (local or S3) ───────────────────────────────
	store, err := storage.New(cfg)
	if err != nil {
		log.Fatalf("[scout] storage init error: %v", err)
	}
	log.Printf("[scout] storage driver: %s", cfg.StorageDriver)

	// ── 5. Initialize notification service ────────────────────────────────
	notifSvc := notifications.NewService(pool)

	// ── 6. Initialize AI service (Groq + RAG) ─────────────────────────────
	aiSvc := ai.NewService(pool, cfg.GroqAPIKey)

	// ── 7. Initialize test runner & queue ─────────────────────────────────
	runnerSvc := runner.NewService(pool, store, notifSvc, aiSvc, cfg.MaxConcurrentRuns)
	runnerSvc.StartWorkers(context.Background())
	log.Printf("[scout] runner ready (max concurrent: %d)", cfg.MaxConcurrentRuns)

	// ── 8. Initialize SCORM service ───────────────────────────────────────
	scormSvc := scorm.NewService(pool, store, notifSvc, cfg.PhoenixBaseURL)

	// ── 9. Seed SCORM generator registry to DB ────────────────────────────
	if err := scormSvc.SeedGenerators(context.Background()); err != nil {
		log.Printf("[scout] WARN: scorm seed error: %v", err)
	} else {
		log.Println("[scout] scorm generators seeded")
	}

	// ── 10. Initialize auth service ───────────────────────────────────────
	authSvc := auth.NewService(cfg, pool)

	// ── 10b. Initialize GitLab integration service ────────────────────────
	gitLabSvc := gitlab.NewService(cfg, pool)
	if gitLabSvc.IsConfigured() {
		log.Println("[scout] gitlab integration enabled")
	} else {
		log.Println("[scout] gitlab integration disabled (GITLAB_CLIENT_ID not set)")
	}

	// ── 10c. Initialize YouTrack integration service ──────────────────────
	youtrackSvc := youtrack.NewService(pool)
	log.Println("[scout] youtrack integration ready")

	// ── 11. Register all HTTP routes ──────────────────────────────────────
	// rootCtx scopes long-lived background goroutines started by the API layer
	// (rate-limit cleanup, etc.) to the server lifetime.
	rootCtx, rootCancel := context.WithCancel(context.Background())
	defer rootCancel()

	// ── 11b. Start scheduled-run cron engine ─────────────────────────────
	schedulerSvc := scheduler.NewService(pool, runnerSvc)
	schedulerSvc.Start(rootCtx)
	log.Println("[scout] scheduler started")

	mux := api.RegisterRoutes(rootCtx, api.Services{
		Config:        cfg,
		DB:            pool,
		Auth:          authSvc,
		Storage:       store,
		Runner:        runnerSvc,
		AI:            aiSvc,
		SCORM:         scormSvc,
		Notifications: notifSvc,
		GitLab:        gitLabSvc,
		YouTrack:      youtrackSvc,
	})
	log.Println("[scout] routes registered")

	// ── 12. HTTP server with graceful shutdown ────────────────────────────
	srv := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      mux,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 120 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Start server in background goroutine
	go func() {
		log.Printf("[scout] listening on :%s", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[scout] server error: %v", err)
		}
	}()

	// Wait for interrupt signal
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	sig := <-quit
	log.Printf("[scout] received signal %s — shutting down", sig)

	// Stop background middleware goroutines (rate-limit cleanup, etc.)
	rootCancel()

	// Graceful shutdown: give in-flight requests 30 seconds to finish
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("[scout] graceful shutdown failed: %v", err)
	}
	log.Println("[scout] server stopped cleanly")
}
