package ai

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Config represents the per-org AI bot configuration stored in bot_configs.
type Config struct {
	OrgID        uuid.UUID `json:"org_id"`
	SystemPrompt string    `json:"system_prompt"`
	Model        string    `json:"model"`
	Temperature  float64   `json:"temperature"`
	MaxTokens    int       `json:"max_tokens"`
	RAGEnabled   bool      `json:"rag_enabled"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// Service is the top-level AI service wired in main.go.
// It satisfies the runner.AIIndexer interface and provides all AI features.
type Service struct {
	db        *pgxpool.Pool
	groq      *GroqClient
	embedSvc  *EmbeddingService
	vecStore  *VectorStore
	rag       *RAGPipeline
	analyzer  *Analyzer
	generator *TestGenerator
	indexer   *Indexer
}

// NewService constructs an AI Service. If groqAPIKey is empty the service
// degrades gracefully (no chat/analysis, RAG disabled).
func NewService(db *pgxpool.Pool, groqAPIKey string) *Service {
	groq := newGroqClient(groqAPIKey)
	embedSvc := newEmbeddingService(groq)
	vecStore := newVectorStore(db)
	rag := newRAGPipeline(embedSvc, vecStore, groq)
	return &Service{
		db:        db,
		groq:      groq,
		embedSvc:  embedSvc,
		vecStore:  vecStore,
		rag:       rag,
		analyzer:  newAnalyzer(db, rag),
		generator: newTestGenerator(rag),
		indexer:   newIndexer(db, rag, vecStore),
	}
}

// IndexRunErrors satisfies the runner.AIIndexer interface.
func (s *Service) IndexRunErrors(ctx context.Context, orgID, runID uuid.UUID) error {
	return s.indexer.IndexRunErrors(ctx, orgID, runID)
}

// ── Config ────────────────────────────────────────────────────────────────────

// GetConfig fetches the bot config for an org, returning defaults if not set.
func (s *Service) GetConfig(ctx context.Context, orgID uuid.UUID) (*Config, error) {
	cfg := &Config{
		OrgID:       orgID,
		Model:       defaultModel,
		Temperature: 0.7,
		MaxTokens:   2048,
		RAGEnabled:  true,
	}

	row := s.db.QueryRow(ctx, `
		SELECT system_prompt, model, temperature, max_tokens, rag_enabled, updated_at
		FROM bot_configs WHERE org_id = $1
	`, orgID)
	err := row.Scan(&cfg.SystemPrompt, &cfg.Model, &cfg.Temperature, &cfg.MaxTokens, &cfg.RAGEnabled, &cfg.UpdatedAt)
	if err != nil {
		// No row yet — return defaults
		return cfg, nil
	}
	return cfg, nil
}

// UpdateConfig upserts the bot config for an org.
func (s *Service) UpdateConfig(ctx context.Context, orgID, updatedBy uuid.UUID, systemPrompt, model string, temperature float64, maxTokens int, ragEnabled bool) (*Config, error) {
	_, err := s.db.Exec(ctx, `
		INSERT INTO bot_configs (org_id, system_prompt, model, temperature, max_tokens, rag_enabled, updated_by, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
		ON CONFLICT (org_id) DO UPDATE SET
			system_prompt = EXCLUDED.system_prompt,
			model         = EXCLUDED.model,
			temperature   = EXCLUDED.temperature,
			max_tokens    = EXCLUDED.max_tokens,
			rag_enabled   = EXCLUDED.rag_enabled,
			updated_by    = EXCLUDED.updated_by,
			updated_at    = NOW()
	`, orgID, systemPrompt, model, temperature, maxTokens, ragEnabled, updatedBy)
	if err != nil {
		return nil, fmt.Errorf("upsert bot_config: %w", err)
	}
	return s.GetConfig(ctx, orgID)
}

// ── Chat ──────────────────────────────────────────────────────────────────────

// ChatStream streams a chat completion, calling onToken for each chunk.
func (s *Service) ChatStream(ctx context.Context, orgID uuid.UUID, messages []ChatMessage, onToken func(string) error) error {
	cfg, _ := s.GetConfig(ctx, orgID)

	// Build system message from config
	sysPrompt := cfg.SystemPrompt
	if sysPrompt == "" {
		sysPrompt = "You are a helpful QA automation assistant for the Scout platform."
	}

	full := make([]ChatMessage, 0, len(messages)+1)
	full = append(full, ChatMessage{Role: "system", Content: sysPrompt})
	full = append(full, messages...)

	return s.groq.ChatStream(ctx, cfg.Model, full, cfg.Temperature, cfg.MaxTokens, onToken)
}

// ── Analysis ──────────────────────────────────────────────────────────────────

// AnalyzeRun analyzes all failures in a run and returns a structured result.
func (s *Service) AnalyzeRun(ctx context.Context, orgID, runID uuid.UUID) (*AnalysisResult, error) {
	cfg, _ := s.GetConfig(ctx, orgID)
	return s.analyzer.AnalyzeRun(ctx, orgID, runID, cfg.Model, cfg.Temperature)
}

// ── Test generation ───────────────────────────────────────────────────────────

// GenerateTest generates a Playwright test from a plain-English description.
func (s *Service) GenerateTest(ctx context.Context, orgID uuid.UUID, description, subProjectName string) (*GeneratedTest, error) {
	cfg, _ := s.GetConfig(ctx, orgID)
	return s.generator.GenerateTest(ctx, orgID, description, subProjectName, cfg.Model, cfg.Temperature)
}
