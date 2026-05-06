package config

import (
	"bufio"
	"fmt"
	"os"
	"strconv"
	"strings"
)

// loadDotEnv reads a .env file and sets any unset environment variables from it.
// Lines starting with # and blank lines are ignored. Already-set env vars win.
func loadDotEnv(path string) {
	f, err := os.Open(path)
	if err != nil {
		return // no .env file — that's fine
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		k = strings.TrimSpace(k)
		v = strings.TrimSpace(v)
		if os.Getenv(k) == "" {
			_ = os.Setenv(k, v)
		}
	}
}

// Config holds all runtime configuration loaded from environment variables.
// Zero hardcoded values — everything comes from the environment at startup.
type Config struct {
	// Server
	Port        string // default: "8080"
	Environment string // "development" | "production"

	// Database
	DatabaseURL string // NeonDB / PostgreSQL connection string

	// Google OAuth
	GoogleClientID     string
	GoogleClientSecret string
	GoogleRedirectURL  string

	// JWT
	JWTSecret string

	// Storage
	StorageDriver     string // "local" | "s3"
	StorageLocalDir   string // default: "./data"
	StorageS3Bucket   string
	StorageS3Region   string
	StorageS3Endpoint string // optional — for MinIO / compatible

	// AI
	GroqAPIKey string

	// GitLab OAuth
	GitLabClientID     string
	GitLabClientSecret string
	GitLabBaseURL      string // default: "https://gitlab.com"

	// SCORM / Phoenix
	PhoenixBaseURL string // internal service URL, e.g. http://phoenix.internal

	// Platform
	PlatformAdminEmails []string // comma-separated env var → slice

	// Run limits
	MaxConcurrentRuns int // default: 3

	// Frontend URL (for OAuth redirect, CORS)
	FrontendURL string // default: "http://localhost:3000"
}

// Load reads all configuration from environment variables.
// It first loads a .env file from the working directory (if present),
// then fails fast with a descriptive error if any required variable is missing.
func Load() (*Config, error) {
	loadDotEnv(".env")
	cfg := &Config{}
	var missing []string

	// ── Helpers ───────────────────────────────────────────────────────────

	required := func(key string) string {
		v := os.Getenv(key)
		if v == "" {
			missing = append(missing, key)
		}
		return v
	}

	optional := func(key, fallback string) string {
		if v := os.Getenv(key); v != "" {
			return v
		}
		return fallback
	}

	optionalInt := func(key string, fallback int) int {
		if v := os.Getenv(key); v != "" {
			n, err := strconv.Atoi(v)
			if err != nil {
				return fallback
			}
			return n
		}
		return fallback
	}

	// ── Server ────────────────────────────────────────────────────────────
	cfg.Port = optional("PORT", "8080")
	cfg.Environment = optional("ENVIRONMENT", "development")
	cfg.FrontendURL = optional("FRONTEND_URL", "http://localhost:3000")

	// ── Database ──────────────────────────────────────────────────────────
	cfg.DatabaseURL = required("DATABASE_URL")

	// ── Google OAuth ──────────────────────────────────────────────────────
	cfg.GoogleClientID = required("GOOGLE_CLIENT_ID")
	cfg.GoogleClientSecret = required("GOOGLE_CLIENT_SECRET")
	cfg.GoogleRedirectURL = required("GOOGLE_REDIRECT_URL")

	// ── JWT ───────────────────────────────────────────────────────────────
	cfg.JWTSecret = required("JWT_SECRET")

	// ── Storage ───────────────────────────────────────────────────────────
	cfg.StorageDriver = optional("STORAGE_DRIVER", "local")
	cfg.StorageLocalDir = optional("STORAGE_LOCAL_DIR", "./data")

	if cfg.StorageDriver == "s3" {
		cfg.StorageS3Bucket = required("STORAGE_S3_BUCKET")
		cfg.StorageS3Region = required("STORAGE_S3_REGION")
		cfg.StorageS3Endpoint = os.Getenv("STORAGE_S3_ENDPOINT") // optional
	}

	// ── AI ────────────────────────────────────────────────────────────────
	cfg.GroqAPIKey = required("GROQ_API_KEY")

	// ── GitLab OAuth ──────────────────────────────────────────────────────
	cfg.GitLabClientID = optional("GITLAB_CLIENT_ID", "")
	cfg.GitLabClientSecret = optional("GITLAB_CLIENT_SECRET", "")
	cfg.GitLabBaseURL = optional("GITLAB_BASE_URL", "https://gitlab.com")

	// ── SCORM / Phoenix ───────────────────────────────────────────────────
	cfg.PhoenixBaseURL = required("PHOENIX_BASE_URL")

	// ── Platform admins ───────────────────────────────────────────────────
	if raw := os.Getenv("PLATFORM_ADMIN_EMAILS"); raw != "" {
		for _, email := range strings.Split(raw, ",") {
			email = strings.TrimSpace(email)
			if email != "" {
				cfg.PlatformAdminEmails = append(cfg.PlatformAdminEmails, email)
			}
		}
	}

	// ── Run limits ────────────────────────────────────────────────────────
	cfg.MaxConcurrentRuns = optionalInt("MAX_CONCURRENT_RUNS", 3)

	// ── Fail fast ─────────────────────────────────────────────────────────
	if len(missing) > 0 {
		return nil, fmt.Errorf(
			"missing required environment variables: %s",
			strings.Join(missing, ", "),
		)
	}

	return cfg, nil
}

// IsProd returns true when running in production mode.
func (c *Config) IsProd() bool {
	return c.Environment == "production"
}
