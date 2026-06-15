package main

import (
	"context"
	"crypto/sha256"
	"fmt"
	"log"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	dbURL := "postgresql://neondb_owner:npg_TYOPvIr8hx2L@ep-solitary-heart-aocmu0bb-pooler.c-2.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
	jwtSecret := "change-me-to-a-long-random-secret-string"

	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil { log.Fatal(err) }
	defer pool.Close()

	var userID uuid.UUID
	var email string
	if err := pool.QueryRow(ctx, `SELECT id, email FROM users WHERE email = 'simranjot@apyhub.com' LIMIT 1`).Scan(&userID, &email); err != nil {
		log.Fatalf("get user: %v", err)
	}

	now := time.Now()
	exp := now.Add(7 * 24 * time.Hour)
	type Claims struct {
		jwt.RegisteredClaims
		UserID      uuid.UUID `json:"uid"`
		Email       string    `json:"email"`
		IsPlatAdmin bool      `json:"is_plat_admin"`
	}
	claims := Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer: "scout-qa", Subject: userID.String(),
			IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(exp),
		},
		UserID: userID, Email: email, IsPlatAdmin: true,
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(jwtSecret))
	if err != nil { log.Fatal(err) }

	hash := fmt.Sprintf("%x", sha256.Sum256([]byte(signed)))
	if _, err := pool.Exec(ctx,
		`INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1,$2,$3) ON CONFLICT (token_hash) DO NOTHING`,
		userID, hash, exp); err != nil {
		log.Fatalf("insert session: %v", err)
	}
	fmt.Print(signed)
}
