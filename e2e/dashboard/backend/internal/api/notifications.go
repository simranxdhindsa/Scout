package api

import (
	"net/http"

	"github.com/apyhub/scout/internal/auth"
	"github.com/apyhub/scout/internal/notifications"
	"github.com/google/uuid"
)

type notificationHandler struct {
	svc Services
}

func newNotificationHandler(svc Services) *notificationHandler {
	return &notificationHandler{svc: svc}
}

// List handles GET /api/v1/me/notifications
func (h *notificationHandler) List(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())

	limit := parseIntQ(r, "limit", 30)
	offset := parseIntQ(r, "offset", 0)

	notifs, err := h.svc.Notifications.ListForUser(r.Context(), claims.UserID, limit, offset)
	if err != nil {
		writeError(w, "failed to list notifications", http.StatusInternalServerError)
		return
	}

	unread, _ := h.svc.Notifications.UnreadCount(r.Context(), claims.UserID)

	if notifs == nil {
		notifs = []notifications.Notification{}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"notifications": notifs,
		"unread_count":  unread,
		"limit":         limit,
		"offset":        offset,
	})
}

// Read handles POST /api/v1/me/notifications/:notifId/read
func (h *notificationHandler) Read(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())

	notifID, err := uuid.Parse(r.PathValue("notifId"))
	if err != nil {
		writeError(w, "invalid notifId", http.StatusBadRequest)
		return
	}

	if err := h.svc.Notifications.MarkRead(r.Context(), notifID, claims.UserID); err != nil {
		writeError(w, "failed to mark notification read", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "read"})
}

// ReadAll handles POST /api/v1/me/notifications/read-all
func (h *notificationHandler) ReadAll(w http.ResponseWriter, r *http.Request) {
	claims := auth.ClaimsFromContext(r.Context())

	if err := h.svc.Notifications.MarkAllRead(r.Context(), claims.UserID); err != nil {
		writeError(w, "failed to mark all notifications read", http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "all read"})
}
