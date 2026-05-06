package db

import (
	"context"
	"embed"
	"fmt"
	"io/fs"
	"log"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// migrationFiles embeds all SQL migration files at compile time.
// The migrations directory is relative to this file's package.
//
//go:embed migrations/*.sql
var migrationFiles embed.FS

// Connect creates and validates a pgxpool connection pool.
func Connect(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse database URL: %w", err)
	}

	// Pool settings — tuned for a small internal platform
	cfg.MaxConns = 20
	cfg.MinConns = 2

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("create pool: %w", err)
	}

	// Verify connection
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}

	return pool, nil
}

// RunMigrations applies all embedded SQL migrations in alphabetical order.
// Already-applied migrations are skipped (idempotent).
// Each migration runs in its own transaction — if one fails, the server stops.
func RunMigrations(ctx context.Context, pool *pgxpool.Pool) error {
	// Ensure the migrations tracking table exists
	_, err := pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			name       TEXT PRIMARY KEY,
			applied_at TIMESTAMPTZ DEFAULT NOW()
		)
	`)
	if err != nil {
		return fmt.Errorf("create schema_migrations table: %w", err)
	}

	// Read all embedded .sql files
	entries, err := fs.ReadDir(migrationFiles, "migrations")
	if err != nil {
		return fmt.Errorf("read migrations dir: %w", err)
	}

	// Sort alphabetically — ensures 001, 002, 003 order
	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Name() < entries[j].Name()
	})

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}

		name := entry.Name()

		// Check if already applied
		var count int
		err := pool.QueryRow(ctx,
			`SELECT COUNT(*) FROM schema_migrations WHERE name = $1`, name,
		).Scan(&count)
		if err != nil {
			return fmt.Errorf("check migration %s: %w", name, err)
		}
		if count > 0 {
			log.Printf("[migrations] skipping %s (already applied)", name)
			continue
		}

		// Read migration SQL
		sqlBytes, err := migrationFiles.ReadFile("migrations/" + name)
		if err != nil {
			return fmt.Errorf("read migration %s: %w", name, err)
		}

		// Execute in a transaction
		tx, err := pool.Begin(ctx)
		if err != nil {
			return fmt.Errorf("begin transaction for %s: %w", name, err)
		}

		if _, err := tx.Exec(ctx, string(sqlBytes)); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("apply migration %s: %w", name, err)
		}

		if _, err := tx.Exec(ctx,
			`INSERT INTO schema_migrations (name) VALUES ($1)`, name,
		); err != nil {
			_ = tx.Rollback(ctx)
			return fmt.Errorf("record migration %s: %w", name, err)
		}

		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("commit migration %s: %w", name, err)
		}

		log.Printf("[migrations] applied %s", name)
	}

	return nil
}
