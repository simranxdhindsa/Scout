package auth

import (
	"context"
	"crypto/sha256"
	"fmt"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	jwtExpiry     = 7 * 24 * time.Hour // 7 days
	jwtIssuer     = "scout-qa"
	bearerPrefix  = "Bearer "
)

// Claims is the custom JWT payload stored in every Scout token.
type Claims struct {
	jwt.RegisteredClaims
	UserID      uuid.UUID `json:"uid"`
	Email       string    `json:"email"`
	IsPlatAdmin bool      `json:"is_plat_admin"`
}

// jwtManager handles token issuance and validation.
type jwtManager struct {
	secret []byte
	db     *pgxpool.Pool
}

// newJWTManager creates a jwtManager with the given HMAC secret.
func newJWTManager(secret string, db *pgxpool.Pool) *jwtManager {
	return &jwtManager{
		secret: []byte(secret),
		db:     db,
	}
}

// Issue creates a signed JWT for the given user and records it in the sessions table.
func (m *jwtManager) Issue(ctx context.Context, userID uuid.UUID, email string, isPlatAdmin bool) (string, error) {
	now := time.Now()
	expiresAt := now.Add(jwtExpiry)

	claims := Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    jwtIssuer,
			Subject:   userID.String(),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
		},
		UserID:      userID,
		Email:       email,
		IsPlatAdmin: isPlatAdmin,
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString(m.secret)
	if err != nil {
		return "", fmt.Errorf("sign jwt: %w", err)
	}

	// Record token hash in sessions table for revocation support
	hash := hashToken(signed)
	_, err = m.db.Exec(ctx,
		`INSERT INTO sessions (user_id, token_hash, expires_at)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (token_hash) DO NOTHING`,
		userID, hash, expiresAt,
	)
	if err != nil {
		return "", fmt.Errorf("record session: %w", err)
	}

	return signed, nil
}

// Validate parses and validates a JWT string, returning the embedded claims.
// It also checks the sessions table to support token revocation.
func (m *jwtManager) Validate(ctx context.Context, tokenStr string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &Claims{}, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return m.secret, nil
	})
	if err != nil {
		return nil, fmt.Errorf("parse jwt: %w", err)
	}

	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid jwt claims")
	}

	// Check session is still active (not revoked / expired in DB)
	hash := hashToken(tokenStr)
	var count int
	err = m.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM sessions
		 WHERE token_hash = $1 AND expires_at > NOW()`,
		hash,
	).Scan(&count)
	if err != nil {
		return nil, fmt.Errorf("check session: %w", err)
	}
	if count == 0 {
		return nil, fmt.Errorf("session expired or revoked")
	}

	return claims, nil
}

// Revoke deletes the session record, effectively invalidating the token.
func (m *jwtManager) Revoke(ctx context.Context, tokenStr string) error {
	hash := hashToken(tokenStr)
	_, err := m.db.Exec(ctx,
		`DELETE FROM sessions WHERE token_hash = $1`, hash,
	)
	return err
}

// ExtractBearer strips the "Bearer " prefix from an Authorization header value.
func ExtractBearer(header string) (string, error) {
	if !strings.HasPrefix(header, bearerPrefix) {
		return "", fmt.Errorf("authorization header must start with 'Bearer '")
	}
	token := strings.TrimPrefix(header, bearerPrefix)
	if token == "" {
		return "", fmt.Errorf("empty bearer token")
	}
	return token, nil
}

// hashToken returns the SHA-256 hex digest of a token string.
// Used as the key in the sessions table — we never store raw tokens.
func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return fmt.Sprintf("%x", sum)
}
