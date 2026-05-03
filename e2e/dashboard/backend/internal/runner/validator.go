package runner

import (
	"fmt"
	"regexp"
	"strings"
)

// ValidationError describes a specific problem found in an uploaded test file.
type ValidationError struct {
	Line    int    `json:"line"`
	Message string `json:"message"`
}

func (e ValidationError) Error() string {
	if e.Line > 0 {
		return fmt.Sprintf("line %d: %s", e.Line, e.Message)
	}
	return e.Message
}

// ValidationResult holds the outcome of validating an uploaded test file.
type ValidationResult struct {
	Valid  bool              `json:"valid"`
	Errors []ValidationError `json:"errors,omitempty"`
}

// forbidden patterns — reject files containing these
var forbiddenPatterns = []struct {
	re      *regexp.Regexp
	message string
}{
	{
		re:      regexp.MustCompile(`(?i)(password|passwd|secret|api_key)\s*=\s*['"][^'"]{4,}['"]`),
		message: "hardcoded credential detected — use process.env variables instead",
	},
	{
		re:      regexp.MustCompile(`https?://[a-z0-9\-]+\.(dev|stage|prod|staging|local)[^'"]*`),
		message: "hardcoded environment URL detected — use process.env.TESTDECK_BASE_URL",
	},
	{
		re:      regexp.MustCompile(`baseURL\s*:\s*['"]https?://`),
		message: "hardcoded baseURL in test file — Scout injects this from the environment config",
	},
}

// requiredPatterns — file must contain at least one of these
var requiredPatterns = []*regexp.Regexp{
	regexp.MustCompile(`@playwright/test`),
	regexp.MustCompile(`from\s+['"]playwright['"]`),
}

const (
	maxFileSizeBytes = 500 * 1024 // 500 KB
	maxLineLength    = 2000
)

// ValidateTestFile checks an uploaded .ts/.js file for:
//  1. File size limit
//  2. Playwright import presence
//  3. Forbidden patterns (hardcoded URLs, credentials)
//  4. Line length sanity
//
// It does NOT run esbuild — that is done separately in the bundler.
func ValidateTestFile(content string, filename string) ValidationResult {
	var errs []ValidationError

	// ── 1. Size check ─────────────────────────────────────────────────────
	if len(content) > maxFileSizeBytes {
		return ValidationResult{
			Valid: false,
			Errors: []ValidationError{{
				Message: fmt.Sprintf("file too large: %d bytes (max %d)", len(content), maxFileSizeBytes),
			}},
		}
	}

	// ── 2. Extension check ────────────────────────────────────────────────
	if !strings.HasSuffix(filename, ".ts") && !strings.HasSuffix(filename, ".js") {
		errs = append(errs, ValidationError{
			Message: fmt.Sprintf("unsupported file type %q — only .ts and .js files are accepted", filename),
		})
	}

	// ── 3. Playwright import check ────────────────────────────────────────
	hasPlaywright := false
	for _, re := range requiredPatterns {
		if re.MatchString(content) {
			hasPlaywright = true
			break
		}
	}
	if !hasPlaywright {
		errs = append(errs, ValidationError{
			Message: "file must import from '@playwright/test' or 'playwright'",
		})
	}

	// ── 4. Line-by-line checks ────────────────────────────────────────────
	lines := strings.Split(content, "\n")
	for i, line := range lines {
		lineNum := i + 1

		// Skip comment lines
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "//") || strings.HasPrefix(trimmed, "*") {
			continue
		}

		// Forbidden patterns
		for _, fp := range forbiddenPatterns {
			if fp.re.MatchString(line) {
				errs = append(errs, ValidationError{
					Line:    lineNum,
					Message: fp.message,
				})
			}
		}

		// Line length sanity
		if len(line) > maxLineLength {
			errs = append(errs, ValidationError{
				Line:    lineNum,
				Message: fmt.Sprintf("line too long (%d chars) — possible minified/generated code", len(line)),
			})
		}
	}

	// ── 5. Empty file check ───────────────────────────────────────────────
	if strings.TrimSpace(content) == "" {
		errs = append(errs, ValidationError{
			Message: "file is empty",
		})
	}

	return ValidationResult{
		Valid:  len(errs) == 0,
		Errors: errs,
	}
}
