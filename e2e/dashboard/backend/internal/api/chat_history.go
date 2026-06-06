package api

import (
	"net/http"

	"github.com/apyhub/scout/internal/auth"
	"github.com/apyhub/scout/internal/db/queries"
	"github.com/google/uuid"
)

type chatHistoryHandler struct {
	svc Services
}

func newChatHistoryHandler(svc Services) *chatHistoryHandler {
	return &chatHistoryHandler{svc: svc}
}

// ListSessions handles GET /api/v1/orgs/:orgId/ai/sessions
func (h *chatHistoryHandler) ListSessions(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}
	claims := auth.ClaimsFromContext(r.Context())
	chatQ := queries.NewChatQueries(h.svc.DB)
	sessions, err := chatQ.ListSessions(r.Context(), orgID, claims.UserID)
	if err != nil {
		writeError(w, "failed to list sessions", http.StatusInternalServerError)
		return
	}
	if sessions == nil {
		sessions = []queries.ChatSession{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"sessions": sessions})
}

// CreateSession handles POST /api/v1/orgs/:orgId/ai/sessions
func (h *chatHistoryHandler) CreateSession(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}
	claims := auth.ClaimsFromContext(r.Context())
	var body struct {
		Title string `json:"title"`
	}
	_ = decodeBody(r, &body)
	if body.Title == "" {
		body.Title = "New chat"
	}
	chatQ := queries.NewChatQueries(h.svc.DB)
	session, err := chatQ.CreateSession(r.Context(), orgID, claims.UserID, body.Title)
	if err != nil {
		writeError(w, "failed to create session", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusCreated, session)
}

// GetMessages handles GET /api/v1/orgs/:orgId/ai/sessions/:sessionId/messages
func (h *chatHistoryHandler) GetMessages(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}
	sessionID, err := uuid.Parse(r.PathValue("sessionId"))
	if err != nil {
		writeError(w, "invalid sessionId", http.StatusBadRequest)
		return
	}
	claims := auth.ClaimsFromContext(r.Context())
	chatQ := queries.NewChatQueries(h.svc.DB)
	session, err := chatQ.GetSession(r.Context(), sessionID)
	if err != nil || session.OrgID != orgID || session.UserID != claims.UserID {
		writeError(w, "session not found", http.StatusNotFound)
		return
	}
	messages, err := chatQ.ListMessages(r.Context(), sessionID)
	if err != nil {
		writeError(w, "failed to list messages", http.StatusInternalServerError)
		return
	}
	if messages == nil {
		messages = []queries.ChatMessage{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"messages": messages})
}

// AddMessage handles POST /api/v1/orgs/:orgId/ai/sessions/:sessionId/messages
func (h *chatHistoryHandler) AddMessage(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}
	sessionID, err := uuid.Parse(r.PathValue("sessionId"))
	if err != nil {
		writeError(w, "invalid sessionId", http.StatusBadRequest)
		return
	}
	claims := auth.ClaimsFromContext(r.Context())
	var body struct {
		Role    string `json:"role"`
		Content string `json:"content"`
	}
	if err := decodeBody(r, &body); err != nil || body.Content == "" {
		writeError(w, "role and content are required", http.StatusBadRequest)
		return
	}
	if body.Role == "" {
		body.Role = "user"
	}
	if body.Role != "user" && body.Role != "assistant" {
		writeError(w, "invalid role: only 'user' and 'assistant' are accepted", http.StatusBadRequest)
		return
	}
	chatQ := queries.NewChatQueries(h.svc.DB)
	session, err := chatQ.GetSession(r.Context(), sessionID)
	if err != nil || session.OrgID != orgID || session.UserID != claims.UserID {
		writeError(w, "session not found", http.StatusNotFound)
		return
	}
	msg, err := chatQ.AddMessage(r.Context(), sessionID, body.Role, body.Content)
	if err != nil {
		writeError(w, "failed to save message", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusCreated, msg)
}

// UpdateSessionTitle handles PUT /api/v1/orgs/:orgId/ai/sessions/:sessionId
func (h *chatHistoryHandler) UpdateSessionTitle(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}
	sessionID, err := uuid.Parse(r.PathValue("sessionId"))
	if err != nil {
		writeError(w, "invalid sessionId", http.StatusBadRequest)
		return
	}
	claims := auth.ClaimsFromContext(r.Context())
	var body struct {
		Title string `json:"title"`
	}
	if err := decodeBody(r, &body); err != nil || body.Title == "" {
		writeError(w, "title is required", http.StatusBadRequest)
		return
	}
	chatQ := queries.NewChatQueries(h.svc.DB)
	session, err := chatQ.GetSession(r.Context(), sessionID)
	if err != nil || session.OrgID != orgID || session.UserID != claims.UserID {
		writeError(w, "session not found", http.StatusNotFound)
		return
	}
	if err := chatQ.UpdateSessionTitle(r.Context(), sessionID, body.Title); err != nil {
		writeError(w, "failed to update session", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// DeleteSession handles DELETE /api/v1/orgs/:orgId/ai/sessions/:sessionId
func (h *chatHistoryHandler) DeleteSession(w http.ResponseWriter, r *http.Request) {
	orgID, err := uuid.Parse(r.PathValue("orgId"))
	if err != nil {
		writeError(w, "invalid orgId", http.StatusBadRequest)
		return
	}
	sessionID, err := uuid.Parse(r.PathValue("sessionId"))
	if err != nil {
		writeError(w, "invalid sessionId", http.StatusBadRequest)
		return
	}
	claims := auth.ClaimsFromContext(r.Context())
	chatQ := queries.NewChatQueries(h.svc.DB)
	session, err := chatQ.GetSession(r.Context(), sessionID)
	if err != nil || session.OrgID != orgID || session.UserID != claims.UserID {
		writeError(w, "session not found", http.StatusNotFound)
		return
	}
	if err := chatQ.DeleteSession(r.Context(), sessionID); err != nil {
		writeError(w, "failed to delete session", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}
