// Temporary dev helper — generates a JWT and inserts it into the sessions table.
// Usage: go run ./cmd/gentoken
// Delete after use.
package main

import (
	"bufio"
	"context"
	"crypto/sha256"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	loadDotEnv(".env")

	dbURL := os.Getenv("DATABASE_URL")
	secret := os.Getenv("JWT_SECRET")
	if dbURL == "" || secret == "" {
		fmt.Fprintln(os.Stderr, "DATABASE_URL and JWT_SECRET must be set")
		os.Exit(1)
	}

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		fmt.Fprintln(os.Stderr, "db connect:", err)
		os.Exit(1)
	}
	defer pool.Close()

	var userID uuid.UUID
	var email string
	err = pool.QueryRow(ctx,
		`SELECT id, email FROM users ORDER BY created_at LIMIT 1`,
	).Scan(&userID, &email)
	if err != nil {
		fmt.Fprintln(os.Stderr, "find user:", err)
		os.Exit(1)
	}

	now := time.Now()
	exp := now.Add(7 * 24 * time.Hour)
	claims := jwt.MapClaims{
		"iss": "scout-qa",
		"sub": userID.String(),
		"iat": now.Unix(),
		"exp": exp.Unix(),
		"uid": userID.String(),
		"email": email,
		"is_plat_admin": false,
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := tok.SignedString([]byte(secret))
	if err != nil {
		fmt.Fprintln(os.Stderr, "sign:", err)
		os.Exit(1)
	}

	hash := fmt.Sprintf("%x", sha256.Sum256([]byte(signed)))
	_, err = pool.Exec(ctx,
		`INSERT INTO sessions (user_id, token_hash, expires_at)
		 VALUES ($1, $2, $3) ON CONFLICT (token_hash) DO NOTHING`,
		userID, hash, exp,
	)
	if err != nil {
		fmt.Fprintln(os.Stderr, "insert session:", err)
		os.Exit(1)
	}

	fmt.Println(signed)
}

func loadDotEnv(path string) {
	f, err := os.Open(path)
	if err != nil {
		return
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
		if os.Getenv(strings.TrimSpace(k)) == "" {
			_ = os.Setenv(strings.TrimSpace(k), strings.TrimSpace(v))
		}
	}
}
