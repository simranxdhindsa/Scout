package ai

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Analyzer produces AI-powered analysis of test run failures.
type Analyzer struct {
	db  *pgxpool.Pool
	rag *RAGPipeline
}

func newAnalyzer(db *pgxpool.Pool, rag *RAGPipeline) *Analyzer {
	return &Analyzer{db: db, rag: rag}
}

// AnalysisResult is the structured output of a run failure analysis.
type AnalysisResult struct {
	RunID      uuid.UUID       `json:"run_id"`
	Summary    string          `json:"summary"`
	RootCauses []RootCause     `json:"root_causes"`
	Suggestions []string       `json:"suggestions"`
	RawResponse string         `json:"raw_response"`
}

// RootCause describes one identified failure pattern.
type RootCause struct {
	TestName string `json:"test_name"`
	Category string `json:"category"` // "selector", "timeout", "auth", "network", "assertion", "unknown"
	Detail   string `json:"detail"`
}

type failureRow struct {
	ID           uuid.UUID
	Name         string
	FileName     string
	ErrorMessage string
	ErrorStack   string
	DurationMs   *int
	RetryCount   int
}

// AnalyzeRun fetches all failures for a run and asks Groq to explain them.
func (a *Analyzer) AnalyzeRun(ctx context.Context, orgID, runID uuid.UUID, model string, temperature float64) (*AnalysisResult, error) {
	// Fetch failed items
	rows, err := a.db.Query(ctx, `
		SELECT ri.id, COALESCE(tc.name, ''), COALESCE(tc.file_name, ''),
		       COALESCE(ri.error_message, ''), COALESCE(ri.error_stack, ''),
		       ri.duration_ms, ri.retry_count
		FROM run_items ri
		LEFT JOIN test_cases tc ON tc.id = ri.test_case_id
		WHERE ri.run_id = $1
		  AND ri.status IN ('failed', 'timedOut')
		ORDER BY ri.started_at ASC
	`, runID)
	if err != nil {
		return nil, fmt.Errorf("fetch failures: %w", err)
	}
	defer rows.Close()

	var failures []failureRow
	for rows.Next() {
		var f failureRow
		if err := rows.Scan(
			&f.ID, &f.Name, &f.FileName, &f.ErrorMessage, &f.ErrorStack,
			&f.DurationMs, &f.RetryCount,
		); err != nil {
			continue
		}
		failures = append(failures, f)
	}

	if len(failures) == 0 {
		return &AnalysisResult{
			RunID:   runID,
			Summary: "No failures found in this run.",
		}, nil
	}

	// Build the analysis prompt
	prompt := buildAnalysisPrompt(runID, failures)

	// Retrieve relevant historical context via RAG
	docs, _ := a.rag.Retrieve(ctx, orgID, prompt)
	context := a.rag.BuildContext(docs)

	systemPrompt := `You are a QA automation expert. Analyze the provided test failures and:
1. Write a concise summary (2-3 sentences)
2. Identify root causes for each failure (selector issue, timeout, auth, network, assertion, or unknown)
3. Provide 3-5 actionable suggestions to fix the failures

Format your response as:
## Summary
<summary>

## Root Causes
- **<test name>**: <category> — <brief explanation>

## Suggestions
1. <suggestion>
2. <suggestion>
...`

	if context != "" {
		systemPrompt += "\n\n" + context
	}

	messages := []ChatMessage{
		{Role: "user", Content: prompt},
	}

	resp, err := a.rag.groq.Chat(ctx, model, append([]ChatMessage{
		{Role: "system", Content: systemPrompt},
	}, messages...), temperature, 2048)
	if err != nil {
		return nil, fmt.Errorf("groq analysis: %w", err)
	}

	rawResponse := ""
	if len(resp.Choices) > 0 {
		rawResponse = resp.Choices[0].Message.Content
	}

	result := &AnalysisResult{
		RunID:       runID,
		RawResponse: rawResponse,
	}

	// Parse the structured sections from the response
	parseAnalysisResponse(rawResponse, result, failures)

	return result, nil
}

// buildAnalysisPrompt creates the user prompt containing all failure details.
func buildAnalysisPrompt(runID uuid.UUID, failures []failureRow) string {
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Analyze the following %d test failure(s) from run %s:\n\n", len(failures), runID))

	for i, f := range failures {
		sb.WriteString(fmt.Sprintf("### Failure %d: %s\n", i+1, orName(f.Name, f.FileName)))
		sb.WriteString(fmt.Sprintf("File: %s\n", f.FileName))
		if f.RetryCount > 0 {
			sb.WriteString(fmt.Sprintf("Retried: %d times\n", f.RetryCount))
		}
		sb.WriteString(fmt.Sprintf("Error: %s\n", f.ErrorMessage))
		if f.ErrorStack != "" {
			stack := f.ErrorStack
			if len(stack) > 500 {
				stack = stack[:500] + "..."
			}
			sb.WriteString(fmt.Sprintf("Stack:\n```\n%s\n```\n", stack))
		}
		sb.WriteString("\n")
	}

	return sb.String()
}

func parseAnalysisResponse(raw string, result *AnalysisResult, failures interface{}) {
	lines := strings.Split(raw, "\n")
	section := ""

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)

		if strings.HasPrefix(trimmed, "## Summary") {
			section = "summary"
			continue
		}
		if strings.HasPrefix(trimmed, "## Root Causes") {
			section = "causes"
			continue
		}
		if strings.HasPrefix(trimmed, "## Suggestions") {
			section = "suggestions"
			continue
		}

		switch section {
		case "summary":
			if trimmed != "" {
				if result.Summary != "" {
					result.Summary += " "
				}
				result.Summary += trimmed
			}
		case "causes":
			if strings.HasPrefix(trimmed, "- **") {
				cause := parseRootCause(trimmed)
				if cause != nil {
					result.RootCauses = append(result.RootCauses, *cause)
				}
			}
		case "suggestions":
			if len(trimmed) > 2 && (trimmed[0] >= '1' && trimmed[0] <= '9') {
				suggestion := strings.TrimLeft(trimmed, "0123456789. ")
				if suggestion != "" {
					result.Suggestions = append(result.Suggestions, suggestion)
				}
			}
		}
	}
}

func parseRootCause(line string) *RootCause {
	// Format: - **test name**: category — detail
	line = strings.TrimPrefix(line, "- **")
	parts := strings.SplitN(line, "**:", 2)
	if len(parts) != 2 {
		return nil
	}

	testName := strings.TrimSpace(parts[0])
	rest := strings.TrimSpace(parts[1])

	category := "unknown"
	detail := rest

	categories := []string{"selector", "timeout", "auth", "network", "assertion"}
	for _, cat := range categories {
		if strings.Contains(strings.ToLower(rest), cat) {
			category = cat
			break
		}
	}

	if idx := strings.Index(rest, " — "); idx >= 0 {
		detail = strings.TrimSpace(rest[idx+3:])
	}

	return &RootCause{
		TestName: testName,
		Category: category,
		Detail:   detail,
	}
}

func orName(name, filename string) string {
	if name != "" {
		return name
	}
	return filename
}
