package api

import (
	"net/http"

	"github.com/apyhub/scout/internal/ai"
	"github.com/apyhub/scout/internal/auth"
	"github.com/google/uuid"
)

type aiHandler struct {
	svc Services
}

func newAIHandler(svc Services) *aiHandler {
	return &aiHandler{svc: svc}
}

// GetConfig handles GET /api/v1/orgs/:orgId/ai/config
func (h *aiHandler) GetConfig(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}

	cfg, err := h.svc.AI.GetConfig(r.Context(), orgID)
	if err != nil {
		writeError(w, "failed to get AI config", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, cfg)
}

// UpdateConfig handles PUT /api/v1/orgs/:orgId/ai/config
func (h *aiHandler) UpdateConfig(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}

	claims := auth.ClaimsFromContext(r.Context())

	var body struct {
		SystemPrompt string  `json:"system_prompt"`
		Model        string  `json:"model"`
		Temperature  float64 `json:"temperature"`
		MaxTokens    int     `json:"max_tokens"`
		RAGEnabled   bool    `json:"rag_enabled"`
	}
	if err := decodeBody(r, &body); err != nil {
		writeError(w, "invalid body", http.StatusBadRequest)
		return
	}

	cfg, err := h.svc.AI.UpdateConfig(r.Context(), orgID, claims.UserID, body.SystemPrompt, body.Model, body.Temperature, body.MaxTokens, body.RAGEnabled)
	if err != nil {
		writeError(w, "failed to update AI config", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, cfg)
}

// Chat handles POST /api/v1/orgs/:orgId/ai/chat
// Streams the AI response via SSE (text/event-stream).
func (h *aiHandler) Chat(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}

	var body struct {
		Messages []struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"messages"`
		RAGEnabled *bool `json:"rag_enabled"`
	}
	if err := decodeBody(r, &body); err != nil || len(body.Messages) == 0 {
		writeError(w, "messages are required", http.StatusBadRequest)
		return
	}

	// Set SSE headers
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	flusher, canFlush := w.(http.Flusher)

	// Convert message types
	messages := make([]ai.ChatMessage, len(body.Messages))
	for i, m := range body.Messages {
		messages[i] = ai.ChatMessage{Role: m.Role, Content: m.Content}
	}

	err = h.svc.AI.ChatStream(r.Context(), orgID, messages, func(token string) error {
		_, writeErr := w.Write([]byte("data: " + token + "\n\n"))
		if canFlush {
			flusher.Flush()
		}
		return writeErr
	})

	if err != nil {
		_, _ = w.Write([]byte("data: [ERROR] " + err.Error() + "\n\n"))
	}

	_, _ = w.Write([]byte("data: [DONE]\n\n"))
	if canFlush {
		flusher.Flush()
	}
}

// Analyze handles POST /api/v1/orgs/:orgId/ai/analyze/:runId
func (h *aiHandler) Analyze(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}

	runID, err := uuid.Parse(r.PathValue("runId"))
	if err != nil {
		writeError(w, "invalid runId", http.StatusBadRequest)
		return
	}

	result, err := h.svc.AI.AnalyzeRun(r.Context(), orgID, runID)
	if err != nil {
		writeError(w, "failed to analyze run: "+err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

// GenerateTest handles POST /api/v1/orgs/:orgId/ai/generate-test
func (h *aiHandler) GenerateTest(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}

	var body struct {
		Description    string `json:"description"`
		SubProjectName string `json:"sub_project_name"`
	}
	if err := decodeBody(r, &body); err != nil || body.Description == "" {
		writeError(w, "description is required", http.StatusBadRequest)
		return
	}

	result, err := h.svc.AI.GenerateTest(r.Context(), orgID, body.Description, body.SubProjectName)
	if err != nil {
		writeError(w, "failed to generate test: "+err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
