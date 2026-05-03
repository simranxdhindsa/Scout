package auth

import (
	"context"
	"net/http"

	"github.com/apyhub/scout/internal/config"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// contextKey is an unexported type for context keys in this package.
type contextKey int

const (
	claimsKey  contextKey = iota
	orgRoleKey contextKey = iota
)

// Service bundles all auth capabilities exposed to the rest of the application.
type Service struct {
	google *GoogleProvider
	jwt    *jwtManager
	db     *pgxpool.Pool
	cfg    *config.Config
}

// NewService constructs a fully wired auth.Service.
func NewService(cfg *config.Config, db *pgxpool.Pool) *Service {
	return &Service{
		google: newGoogleProvider(cfg),
		jwt:    newJWTManager(cfg.JWTSecret, db),
		db:     db,
		cfg:    cfg,
	}
}

// ── Google OAuth helpers ──────────────────────────────────────────────────────

// GoogleAuthURL returns the consent URL and sets the CSRF state cookie.
func (s *Service) GoogleAuthURL(w http.ResponseWriter) string {
	return s.google.AuthURL(w)
}

// GoogleExchange validates state, exchanges code, and returns user info.
func (s *Service) GoogleExchange(ctx context.Context, r *http.Request) (*GoogleUserInfo, error) {
	return s.google.Exchange(ctx, r)
}

// ── JWT helpers ───────────────────────────────────────────────────────────────

// IssueToken creates a signed JWT for the given user.
func (s *Service) IssueToken(ctx context.Context, userID uuid.UUID, email string, isPlatAdmin bool) (string, error) {
	return s.jwt.Issue(ctx, userID, email, isPlatAdmin)
}

// RevokeToken invalidates a token by removing its session record.
func (s *Service) RevokeToken(ctx context.Context, tokenStr string) error {
	return s.jwt.Revoke(ctx, tokenStr)
}

// ── HTTP Middleware ───────────────────────────────────────────────────────────

// Authenticate is an HTTP middleware that validates the Bearer JWT on every request.
// On success it stores the claims in the request context.
// On failure it responds 401 and stops the chain.
func (s *Service) Authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tokenStr, err := ExtractBearer(r.Header.Get("Authorization"))
		if err != nil {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}

		claims, err := s.jwt.Validate(r.Context(), tokenStr)
		if err != nil {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}

		// Store claims in context for downstream handlers
		ctx := context.WithValue(r.Context(), claimsKey, claims)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// RequirePlatformAdmin rejects requests from non-platform-admin users with 403.
func (s *Service) RequirePlatformAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims := ClaimsFromContext(r.Context())
		if claims == nil || !claims.IsPlatAdmin {
			http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// RequireOrgMember checks that the authenticated user belongs to the org
// identified by the {orgId} path value. Stores the user's org role in context.
func (s *Service) RequireOrgMember(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		claims := ClaimsFromContext(r.Context())
		if claims == nil {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}

		orgID := r.PathValue("orgId")
		if orgID == "" {
			http.Error(w, `{"error":"missing orgId"}`, http.StatusBadRequest)
			return
		}

		var role string
		err := s.db.QueryRow(r.Context(),
			`SELECT om.role FROM org_members om
			 JOIN organizations o ON o.id = om.org_id
			 WHERE o.id = $1 AND om.user_id = $2 AND o.is_active = TRUE`,
			orgID, claims.UserID,
		).Scan(&role)
		if err != nil {
			http.Error(w, `{"error":"forbidden"}`, http.StatusForbidden)
			return
		}

		ctx := context.WithValue(r.Context(), orgRoleKey, role)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// RequireOrgAdmin rejects members who are not org admins with 403.
// Must be used after RequireOrgMember in the middleware chain.
func (s *Service) RequireOrgAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		role := OrgRoleFromContext(r.Context())
		if role != "admin" {
			http.Error(w, `{"error":"forbidden — org admin required"}`, http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ── Context helpers ───────────────────────────────────────────────────────────

// ClaimsFromContext retrieves the JWT claims stored by the Authenticate middleware.
func ClaimsFromContext(ctx context.Context) *Claims {
	c, _ := ctx.Value(claimsKey).(*Claims)
	return c
}

// OrgRoleFromContext retrieves the org role stored by RequireOrgMember.
func OrgRoleFromContext(ctx context.Context) string {
	r, _ := ctx.Value(orgRoleKey).(string)
	return r
}

// UserIDFromContext is a convenience helper used by handlers.
func UserIDFromContext(ctx context.Context) uuid.UUID {
	c := ClaimsFromContext(ctx)
	if c == nil {
		return uuid.Nil
	}
	return c.UserID
}
