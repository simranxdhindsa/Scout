package youtrack

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// ── API Models ────────────────────────────────────────────────────────────────

type Board struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type Sprint struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Start       int64  `json:"start"`
	Finish      int64  `json:"finish"`
	IsCompleted bool   `json:"isCompleted"`
}

type User struct {
	ID        string `json:"id"`
	Login     string `json:"login"`
	FullName  string `json:"fullName"`
	AvatarUrl string `json:"avatarUrl,omitempty"`
}

type CustomField struct {
	Name  string      `json:"name"`
	Value interface{} `json:"value"`
}

type Issue struct {
	ID           string        `json:"id"`
	IDReadable   string        `json:"idReadable"`
	Summary      string        `json:"summary"`
	Description  string        `json:"description"`
	Created      int64         `json:"created"`
	Updated      int64         `json:"updated"`
	Reporter     *User         `json:"reporter,omitempty"`
	CustomFields []CustomField `json:"customFields"`
}

// ── Client ────────────────────────────────────────────────────────────────────

type Client struct {
	baseURL   string
	token     string
	projectID string
	boardID   string
	hc        *http.Client
}

func NewClient(baseURL, token, projectID, boardID string) *Client {
	u := strings.TrimRight(baseURL, "/")
	if u != "" && !strings.HasPrefix(u, "http://") && !strings.HasPrefix(u, "https://") {
		u = "https://" + u
	}
	return &Client{
		baseURL:   u,
		token:     token,
		projectID: projectID,
		boardID:   boardID,
		hc:        &http.Client{Timeout: 20 * time.Second},
	}
}

func (c *Client) doRequest(ctx context.Context, method, path string, body interface{}) ([]byte, error) {
	var reqBody io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("marshal: %w", err)
		}
		reqBody = bytes.NewBuffer(b)
	}

	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reqBody)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Cache-Control", "no-cache")

	resp, err := c.hc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("youtrack request: %w", err)
	}
	defer resp.Body.Close()

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	switch resp.StatusCode {
	case 200, 201:
		return data, nil
	case 401:
		return nil, fmt.Errorf("invalid YouTrack token — check your permanent token")
	case 403:
		return nil, fmt.Errorf("YouTrack access forbidden — token lacks required permissions")
	case 404:
		return nil, fmt.Errorf("YouTrack resource not found")
	default:
		return nil, fmt.Errorf("YouTrack API %d: %s", resp.StatusCode, string(data))
	}
}

// TestConnection verifies credentials by calling /api/users/me.
func (c *Client) TestConnection(ctx context.Context) error {
	_, err := c.doRequest(ctx, http.MethodGet, "/api/users/me?fields=login,fullName", nil)
	return err
}

// GetBoards lists all agile boards accessible with these credentials.
func (c *Client) GetBoards(ctx context.Context) ([]Board, error) {
	data, err := c.doRequest(ctx, http.MethodGet, "/api/agiles?$top=-1&fields=id,name", nil)
	if err != nil {
		return nil, err
	}
	var boards []Board
	if err := json.Unmarshal(data, &boards); err != nil {
		return nil, err
	}
	return boards, nil
}

// GetSprints returns sprints for the configured board.
// If boardID is empty it auto-detects the first board for the configured project.
func (c *Client) GetSprints(ctx context.Context) ([]Sprint, error) {
	boardID, err := c.resolveBoard(ctx)
	if err != nil {
		return nil, err
	}
	path := fmt.Sprintf("/api/agiles/%s/sprints?$top=50&fields=id,name,start,finish,isCompleted", boardID)
	data, err := c.doRequest(ctx, http.MethodGet, path, nil)
	if err != nil {
		return nil, err
	}
	var sprints []Sprint
	if err := json.Unmarshal(data, &sprints); err != nil {
		return nil, err
	}
	return sprints, nil
}

// GetSprintIssues returns all issues in the given sprint.
func (c *Client) GetSprintIssues(ctx context.Context, sprintID string) ([]Issue, error) {
	boardID, err := c.resolveBoard(ctx)
	if err != nil {
		return nil, err
	}
	fields := "id,idReadable,summary,description,created,updated,reporter(id,login,fullName,avatarUrl),customFields(name,value(name,presentation,login,fullName,id))"
	path := fmt.Sprintf("/api/agiles/%s/sprints/%s/issues?$top=200&fields=%s",
		boardID, sprintID, url.QueryEscape(fields))
	data, err := c.doRequest(ctx, http.MethodGet, path, nil)
	if err != nil {
		return nil, err
	}
	var issues []Issue
	if err := json.Unmarshal(data, &issues); err != nil {
		return nil, err
	}
	return issues, nil
}

// SearchIssues runs a YQL query and returns matching issues.
func (c *Client) SearchIssues(ctx context.Context, yqlQuery string, limit int) ([]Issue, error) {
	if limit <= 0 {
		limit = 100
	}
	fields := "id,idReadable,summary,customFields(name,value(name,presentation))"
	path := fmt.Sprintf("/api/issues?fields=%s&query=%s&$top=%d",
		url.QueryEscape(fields), url.QueryEscape(yqlQuery), limit)
	data, err := c.doRequest(ctx, http.MethodGet, path, nil)
	if err != nil {
		return nil, err
	}
	var issues []Issue
	if err := json.Unmarshal(data, &issues); err != nil {
		return nil, err
	}
	return issues, nil
}

// resolveBoard returns boardID from config or auto-detects from the project.
func (c *Client) resolveBoard(ctx context.Context) (string, error) {
	if c.boardID != "" {
		return c.boardID, nil
	}
	// Auto-detect: list boards and find the first one matching the project
	data, err := c.doRequest(ctx, http.MethodGet,
		"/api/agiles?$top=-1&fields=id,name,projects(shortName),sprintsSettings(disableSprints)", nil)
	if err != nil {
		return "", err
	}
	var boards []struct {
		ID              string `json:"id"`
		Name            string `json:"name"`
		Projects        []struct{ ShortName string `json:"shortName"` } `json:"projects"`
		SprintsSettings struct{ DisableSprints bool `json:"disableSprints"` } `json:"sprintsSettings"`
	}
	if err := json.Unmarshal(data, &boards); err != nil {
		return "", err
	}
	for _, b := range boards {
		if b.SprintsSettings.DisableSprints {
			continue
		}
		for _, p := range b.Projects {
			if strings.EqualFold(p.ShortName, c.projectID) {
				return b.ID, nil
			}
		}
	}
	return "", fmt.Errorf("no board found for project %q — specify a boardID explicitly", c.projectID)
}

// ── Custom Field Helpers ──────────────────────────────────────────────────────

// GetStatus extracts the State custom field value.
func GetStatus(issue Issue) string {
	return GetCustomFieldValue(issue, "State")
}

// GetSubsystem extracts the Subsystem custom field value.
func GetSubsystem(issue Issue) string {
	return GetCustomFieldValue(issue, "Subsystem")
}

// GetPriority extracts the Priority custom field value.
func GetPriority(issue Issue) string {
	v := GetCustomFieldValue(issue, "Priority")
	if v == "" {
		return "Normal"
	}
	return v
}

// GetCustomFieldValue extracts a string value from a named custom field.
func GetCustomFieldValue(issue Issue, fieldName string) string {
	for _, f := range issue.CustomFields {
		if !strings.EqualFold(f.Name, fieldName) {
			continue
		}
		switch v := f.Value.(type) {
		case map[string]interface{}:
			if name, ok := v["name"].(string); ok {
				return name
			}
			if p, ok := v["presentation"].(string); ok {
				return p
			}
		case string:
			return v
		}
	}
	return ""
}
