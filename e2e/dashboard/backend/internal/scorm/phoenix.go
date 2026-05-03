package scorm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"path/filepath"
	"time"
)

// PhoenixClient proxies requests to the internal Phoenix SCORM scraping service.
// Phoenix is never exposed directly — Scout controls auth, storage, and job tracking.
type PhoenixClient struct {
	baseURL    string
	httpClient *http.Client
}

// newPhoenixClient creates a client with a 60-second timeout.
func newPhoenixClient(baseURL string) *PhoenixClient {
	return &PhoenixClient{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 60 * time.Second,
		},
	}
}

// PhoenixUploadResponse is returned by POST /upload on the Phoenix service.
type PhoenixUploadResponse struct {
	JobID  string `json:"job_id"`
	Cached bool   `json:"cached"`
}

// PhoenixResult is the full result payload from GET /status/{job_id}
// when status is "complete", "error", or "failed".
type PhoenixResult struct {
	Status       string              `json:"status"`        // "pending"|"processing"|"complete"|"error"|"failed"
	JobID        string              `json:"job_id"`
	Filename     string              `json:"filename"`
	MarkdownList []PhoenixSCOSection `json:"markdown_list"` // one entry per SCO
	Coverage     float64             `json:"coverage"`
	Languages    []string            `json:"languages"`
	ExternalURLs []string            `json:"external_urls"`
	ErrorDetail  string              `json:"error"`
	SCOCount     int                 `json:"sco_count"`
}

// PhoenixSCOSection represents one SCO's extracted content.
type PhoenixSCOSection struct {
	Index    int    `json:"index"`
	Title    string `json:"title"`
	Markdown string `json:"markdown"`
	Category string `json:"category"`
	Words    int    `json:"words"`
}

// Upload sends a zip file to Phoenix for SCORM scraping.
// Returns the job_id and whether the result was served from Phoenix's cache.
func (p *PhoenixClient) Upload(ctx context.Context, file io.Reader, filename string) (*PhoenixUploadResponse, error) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)

	part, err := writer.CreateFormFile("file", filepath.Base(filename))
	if err != nil {
		return nil, fmt.Errorf("create form file: %w", err)
	}

	if _, err := io.Copy(part, file); err != nil {
		return nil, fmt.Errorf("copy file to form: %w", err)
	}

	if err := writer.Close(); err != nil {
		return nil, fmt.Errorf("close multipart writer: %w", err)
	}

	url := p.baseURL + "/upload"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, &body)
	if err != nil {
		return nil, fmt.Errorf("build upload request: %w", err)
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())

	resp, err := p.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("phoenix upload request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusAccepted {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("phoenix upload returned %d: %s", resp.StatusCode, string(body))
	}

	var result PhoenixUploadResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode upload response: %w", err)
	}

	if result.JobID == "" {
		return nil, fmt.Errorf("phoenix returned empty job_id")
	}

	return &result, nil
}

// Status polls Phoenix for the current status of a job.
// Returns the full PhoenixResult when status is terminal (complete/error/failed).
func (p *PhoenixClient) Status(ctx context.Context, jobID string) (*PhoenixResult, error) {
	url := fmt.Sprintf("%s/status/%s", p.baseURL, jobID)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("build status request: %w", err)
	}

	resp, err := p.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("phoenix status request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusNotFound {
		return nil, fmt.Errorf("job %s not found on phoenix", jobID)
	}

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("phoenix status returned %d: %s", resp.StatusCode, string(body))
	}

	var result PhoenixResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode status response: %w", err)
	}

	return &result, nil
}

// IsTerminal returns true if the Phoenix status string means the job has finished
// (one way or another) and polling should stop.
func IsTerminal(status string) bool {
	switch status {
	case "complete", "error", "failed":
		return true
	default:
		return false
	}
}
