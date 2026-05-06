package ai

import (
	"context"
	"fmt"
	"log"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Indexer auto-indexes run errors and test case content into the RAG vector store.
// Called as a background goroutine after each run completes.
type Indexer struct {
	db          *pgxpool.Pool
	rag         *RAGPipeline
	vectorStore *VectorStore
}

func newIndexer(db *pgxpool.Pool, rag *RAGPipeline, vectorStore *VectorStore) *Indexer {
	return &Indexer{db: db, rag: rag, vectorStore: vectorStore}
}

// IndexRunErrors indexes all failed run items from a completed run into the vector store.
// This gives the AI context about past failures when answering future questions.
func (idx *Indexer) IndexRunErrors(ctx context.Context, orgID, runID uuid.UUID) error {
	// Fetch all failed run items with error details
	rows, err := idx.db.Query(ctx, `
		SELECT ri.id, ri.error_message, ri.error_stack, tc.name, tc.file_name
		FROM run_items ri
		LEFT JOIN test_cases tc ON tc.id = ri.test_case_id
		WHERE ri.run_id = $1
		  AND ri.status IN ('failed', 'timedOut')
		  AND (ri.error_message IS NOT NULL AND ri.error_message != '')
	`, runID)
	if err != nil {
		return fmt.Errorf("fetch failed items: %w", err)
	}
	defer rows.Close()

	type failedItem struct {
		ID           uuid.UUID
		ErrorMessage string
		ErrorStack   string
		TestName     string
		FileName     string
	}

	var items []failedItem
	for rows.Next() {
		var item failedItem
		if err := rows.Scan(
			&item.ID, &item.ErrorMessage, &item.ErrorStack,
			&item.TestName, &item.FileName,
		); err != nil {
			continue
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	if len(items) == 0 {
		return nil
	}

	// Delete old entries for this run to avoid duplicates on re-index
	_, _ = idx.db.Exec(ctx, `
		DELETE FROM rag_documents
		WHERE org_id = $1 AND source_type = 'run_error' AND source_id = $2
	`, orgID, runID)

	// Index each failed item
	for _, item := range items {
		content := buildErrorContent(item.TestName, item.FileName, item.ErrorMessage, item.ErrorStack)
		runIDRef := runID

		if err := idx.rag.Index(ctx, orgID, "run_error", &runIDRef, content); err != nil {
			log.Printf("[indexer] failed to index error for run %s item %s: %v", runID, item.ID, err)
			// Non-fatal — continue with other items
		}
	}

	log.Printf("[indexer] indexed %d errors for run %s", len(items), runID)
	return nil
}

// IndexTestCase indexes a single test case's source content into the vector store.
// Called when a test case is uploaded or updated.
func (idx *Indexer) IndexTestCase(ctx context.Context, orgID, testCaseID uuid.UUID, name, content string) error {
	// Remove old index entries for this test case
	if err := idx.vectorStore.DeleteBySource(ctx, orgID, "test_case", testCaseID); err != nil {
		log.Printf("[indexer] delete old test case index error: %v", err)
	}

	doc := fmt.Sprintf("Test case: %s\n\n%s", name, content)
	if err := idx.rag.Index(ctx, orgID, "test_case", &testCaseID, doc); err != nil {
		return fmt.Errorf("index test case: %w", err)
	}

	return nil
}

// IndexRunReport indexes the aggregated run report summary for trend analysis.
func (idx *Indexer) IndexRunReport(ctx context.Context, orgID, runID uuid.UUID) error {
	var passed, failed, total, durationMs int
	var label string

	err := idx.db.QueryRow(ctx, `
		SELECT rr.passed, rr.failed, rr.total, COALESCE(rr.duration_ms, 0),
		       COALESCE(tr.label, '')
		FROM run_reports rr
		JOIN test_runs tr ON tr.id = rr.run_id
		WHERE rr.run_id = $1
	`, runID).Scan(&passed, &failed, &total, &durationMs, &label)
	if err != nil {
		return fmt.Errorf("fetch run report: %w", err)
	}

	passRate := 0.0
	if total > 0 {
		passRate = float64(passed) / float64(total) * 100
	}

	content := fmt.Sprintf(
		"Run report: %s\nPassed: %d/%d (%.0f%%)\nFailed: %d\nDuration: %dms",
		label, passed, total, passRate, failed, durationMs,
	)

	runIDRef := runID
	return idx.rag.Index(ctx, orgID, "run_report", &runIDRef, content)
}

// buildErrorContent formats a failed test item into a readable string for indexing.
func buildErrorContent(testName, fileName, errorMsg, errorStack string) string {
	var sb strings.Builder

	sb.WriteString("Failed test: ")
	if testName != "" {
		sb.WriteString(testName)
	} else {
		sb.WriteString(fileName)
	}
	sb.WriteString("\n")

	if fileName != "" {
		sb.WriteString("File: ")
		sb.WriteString(fileName)
		sb.WriteString("\n")
	}

	sb.WriteString("\nError: ")
	sb.WriteString(errorMsg)

	if errorStack != "" {
		// Truncate long stack traces
		stack := errorStack
		if len(stack) > 1000 {
			stack = stack[:1000] + "...(truncated)"
		}
		sb.WriteString("\n\nStack trace:\n")
		sb.WriteString(stack)
	}

	return sb.String()
}
