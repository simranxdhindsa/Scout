package runner

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// ── Playwright JSON report structures ─────────────────────────────────────────

// PlaywrightReport is the top-level structure of Playwright's JSON reporter output.
type PlaywrightReport struct {
	Stats   PlaywrightStats  `json:"stats"`
	Suites  []PlaywrightSuite `json:"suites"`
	Errors  []PlaywrightError `json:"errors"`
}

type PlaywrightStats struct {
	Expected   int `json:"expected"`
	Unexpected int `json:"unexpected"`
	Skipped    int `json:"skipped"`
	Flaky      int `json:"flaky"`
	Duration   int `json:"duration"` // milliseconds
}

type PlaywrightSuite struct {
	Title  string            `json:"title"`
	File   string            `json:"file"`
	Suites []PlaywrightSuite `json:"suites"`
	Specs  []PlaywrightSpec  `json:"specs"`
}

type PlaywrightSpec struct {
	Title  string           `json:"title"`
	OK     bool             `json:"ok"`
	Tests  []PlaywrightTest `json:"tests"`
}

type PlaywrightTest struct {
	Status      string                `json:"status"`   // "expected" | "unexpected" | "skipped" | "flaky"
	Duration    int                   `json:"duration"` // ms
	Results     []PlaywrightTestResult `json:"results"`
}

type PlaywrightTestResult struct {
	Status       string                  `json:"status"` // "passed" | "failed" | "timedOut" | "skipped"
	Duration     int                     `json:"duration"`
	Error        *PlaywrightTestError    `json:"error"`
	Attachments  []PlaywrightAttachment  `json:"attachments"`
	RetryIndex   int                     `json:"retry"`
}

type PlaywrightTestError struct {
	Message string `json:"message"`
	Stack   string `json:"stack"`
}

type PlaywrightAttachment struct {
	Name        string `json:"name"`
	ContentType string `json:"contentType"`
	Path        string `json:"path"`
}

type PlaywrightError struct {
	Message string `json:"message"`
}

// ── Parsed result structs (used by runner to save to DB) ─────────────────────

// ParsedResult is the structured output after parsing a Playwright JSON report.
type ParsedResult struct {
	Passed         int
	Failed         int
	Skipped        int
	TimedOut       int
	Total          int
	DurationMs     int
	ConsoleErrors  int
	APIErrors      int
	FailedRequests int
	PageErrors     int
	TestResults    []ParsedTestResult
}

// ParsedTestResult maps one Playwright test spec to its result.
type ParsedTestResult struct {
	FileName     string
	Title        string
	Status       string // "passed" | "failed" | "timedOut" | "skipped"
	DurationMs   int
	ErrorMessage string
	ErrorStack   string
	RetryCount   int
	Attachments  []ParsedAttachment
}

// ParsedAttachment holds a file reference for a screenshot, trace, or video.
type ParsedAttachment struct {
	Type string // "screenshot" | "trace" | "video" | "network-log"
	Path string // absolute local path in the workspace
}

// ParseResults reads and parses the Playwright JSON report from disk.
func ParseResults(resultsPath string) (*ParsedResult, error) {
	data, err := os.ReadFile(resultsPath)
	if err != nil {
		return nil, fmt.Errorf("read results.json: %w", err)
	}

	var report PlaywrightReport
	if err := json.Unmarshal(data, &report); err != nil {
		return nil, fmt.Errorf("parse results.json: %w", err)
	}

	result := &ParsedResult{
		DurationMs: report.Stats.Duration,
	}

	// Flatten all suites → specs → tests recursively
	var flatSpecs []struct {
		File  string
		Spec  PlaywrightSpec
	}
	var flattenSuite func(suite PlaywrightSuite, file string)
	flattenSuite = func(suite PlaywrightSuite, file string) {
		if suite.File != "" {
			file = suite.File
		}
		for _, spec := range suite.Specs {
			flatSpecs = append(flatSpecs, struct {
				File string
				Spec PlaywrightSpec
			}{File: file, Spec: spec})
		}
		for _, child := range suite.Suites {
			flattenSuite(child, file)
		}
	}
	for _, suite := range report.Suites {
		flattenSuite(suite, suite.File)
	}

	for _, item := range flatSpecs {
		for _, test := range item.Spec.Tests {
			result.Total++

			ptr := ParsedTestResult{
				FileName: filepath.Base(item.File),
				Title:    item.Spec.Title,
			}

			// Use the last result (after retries)
			if len(test.Results) > 0 {
				last := test.Results[len(test.Results)-1]
				ptr.Status = normaliseStatus(last.Status)
				ptr.DurationMs = last.Duration
				ptr.RetryCount = last.RetryIndex

				if last.Error != nil {
					ptr.ErrorMessage = last.Error.Message
					ptr.ErrorStack = last.Error.Stack
				}

				for _, att := range last.Attachments {
					ptr.Attachments = append(ptr.Attachments, ParsedAttachment{
						Type: classifyAttachment(att.Name, att.ContentType),
						Path: att.Path,
					})
				}
			} else {
				ptr.Status = normaliseStatus(test.Status)
			}

			switch ptr.Status {
			case "passed":
				result.Passed++
			case "failed":
				result.Failed++
			case "timedOut":
				result.TimedOut++
			case "skipped":
				result.Skipped++
			}

			result.TestResults = append(result.TestResults, ptr)
		}
	}

	// Count global errors as page errors
	result.PageErrors = len(report.Errors)

	return result, nil
}

// normaliseStatus maps Playwright status strings to Scout's canonical set.
func normaliseStatus(s string) string {
	switch strings.ToLower(s) {
	case "passed", "expected":
		return "passed"
	case "failed", "unexpected":
		return "failed"
	case "timedout":
		return "timedOut"
	case "skipped":
		return "skipped"
	default:
		return "failed"
	}
}

// classifyAttachment maps Playwright attachment names/types to Scout's type enum.
func classifyAttachment(name, contentType string) string {
	name = strings.ToLower(name)
	switch {
	case strings.Contains(name, "screenshot") || strings.HasPrefix(contentType, "image/"):
		return "screenshot"
	case strings.Contains(name, "trace") || strings.HasSuffix(name, ".zip"):
		return "trace"
	case strings.Contains(name, "video") || strings.HasPrefix(contentType, "video/"):
		return "video"
	default:
		return "network-log"
	}
}
