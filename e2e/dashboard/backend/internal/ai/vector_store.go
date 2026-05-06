package ai

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pgvector/pgvector-go"
)

// RAGDocument mirrors the rag_documents DB row.
type RAGDocument struct {
	ID         uuid.UUID `json:"id"`
	OrgID      uuid.UUID `json:"org_id"`
	SourceType string    `json:"source_type"`
	SourceID   *uuid.UUID `json:"source_id"`
	Content    string    `json:"content"`
	CreatedAt  time.Time `json:"created_at"`
	// Similarity score — populated by search queries, not stored in DB
	Similarity float64 `json:"similarity,omitempty"`
}

// VectorStore wraps pgvector operations via the pgx driver.
type VectorStore struct {
	db *pgxpool.Pool
}

func newVectorStore(db *pgxpool.Pool) *VectorStore {
	return &VectorStore{db: db}
}

// Insert stores one document chunk with its embedding vector.
func (v *VectorStore) Insert(ctx context.Context, orgID uuid.UUID, sourceType string, sourceID *uuid.UUID, content string, embedding []float32) (uuid.UUID, error) {
	vec := pgvector.NewVector(embedding)

	var id uuid.UUID
	err := v.db.QueryRow(ctx, `
		INSERT INTO rag_documents (org_id, source_type, source_id, content, embedding)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id
	`, orgID, sourceType, sourceID, content, vec).Scan(&id)
	if err != nil {
		return uuid.Nil, fmt.Errorf("insert rag document: %w", err)
	}
	return id, nil
}

// Search performs a cosine similarity search and returns the top-k most relevant documents.
// Only documents belonging to the given orgID are searched (row-level isolation).
func (v *VectorStore) Search(ctx context.Context, orgID uuid.UUID, queryEmbedding []float32, topK int) ([]RAGDocument, error) {
	if topK <= 0 {
		topK = 5
	}

	vec := pgvector.NewVector(queryEmbedding)

	rows, err := v.db.Query(ctx, `
		SELECT id, org_id, source_type, source_id, content, created_at,
		       1 - (embedding <=> $2) AS similarity
		FROM rag_documents
		WHERE org_id = $1
		  AND embedding IS NOT NULL
		ORDER BY embedding <=> $2
		LIMIT $3
	`, orgID, vec, topK)
	if err != nil {
		return nil, fmt.Errorf("vector search: %w", err)
	}
	defer rows.Close()

	var docs []RAGDocument
	for rows.Next() {
		var d RAGDocument
		if err := rows.Scan(
			&d.ID, &d.OrgID, &d.SourceType, &d.SourceID,
			&d.Content, &d.CreatedAt, &d.Similarity,
		); err != nil {
			return nil, err
		}
		docs = append(docs, d)
	}
	return docs, rows.Err()
}

// DeleteBySource removes all RAG documents for a given source (e.g., when a test case is deleted).
func (v *VectorStore) DeleteBySource(ctx context.Context, orgID uuid.UUID, sourceType string, sourceID uuid.UUID) error {
	_, err := v.db.Exec(ctx, `
		DELETE FROM rag_documents
		WHERE org_id = $1 AND source_type = $2 AND source_id = $3
	`, orgID, sourceType, sourceID)
	return err
}

// DeleteByOrg removes all RAG documents for an org (used when an org is deactivated).
func (v *VectorStore) DeleteByOrg(ctx context.Context, orgID uuid.UUID) error {
	_, err := v.db.Exec(ctx, `DELETE FROM rag_documents WHERE org_id = $1`, orgID)
	return err
}

// CountByOrg returns the total number of indexed documents for an org.
func (v *VectorStore) CountByOrg(ctx context.Context, orgID uuid.UUID) (int, error) {
	var count int
	err := v.db.QueryRow(ctx,
		`SELECT COUNT(*) FROM rag_documents WHERE org_id = $1`, orgID,
	).Scan(&count)
	return count, err
}
