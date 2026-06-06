package slack

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

type RunSummary struct {
	OrgName   string
	Label     string
	Status    string
	Passed    int
	Failed    int
	Total     int
	RunID     string
	DashURL   string
}

type payload struct {
	Text        string       `json:"text,omitempty"`
	Attachments []attachment `json:"attachments,omitempty"`
}

type attachment struct {
	Color  string  `json:"color"`
	Blocks []block `json:"blocks"`
}

type block struct {
	Type string    `json:"type"`
	Text *textObj  `json:"text,omitempty"`
	Fields []textObj `json:"fields,omitempty"`
}

type textObj struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

// Notify posts a run completion message to the given webhook URL.
func Notify(ctx context.Context, webhookURL string, run RunSummary) error {
	if webhookURL == "" {
		return nil
	}

	color := "#36a64f" // green
	icon := "✅"
	if run.Status == "failed" {
		color = "#e01e5a"
		icon = "❌"
	} else if run.Status == "stopped" {
		color = "#ecb22e"
		icon = "⚠️"
	}

	title := fmt.Sprintf("%s Run %s: *%s*", icon, run.Label, run.Status)
	fields := []textObj{
		{Type: "mrkdwn", Text: fmt.Sprintf("*Passed*\n%d", run.Passed)},
		{Type: "mrkdwn", Text: fmt.Sprintf("*Failed*\n%d", run.Failed)},
		{Type: "mrkdwn", Text: fmt.Sprintf("*Total*\n%d", run.Total)},
	}
	if run.DashURL != "" && run.RunID != "" {
		fields = append(fields, textObj{
			Type: "mrkdwn",
			Text: fmt.Sprintf("*Run*\n<%s/runs/%s|View details>", run.DashURL, run.RunID),
		})
	}

	p := payload{
		Attachments: []attachment{{
			Color: color,
			Blocks: []block{
				{Type: "section", Text: &textObj{Type: "mrkdwn", Text: title}},
				{Type: "section", Fields: fields},
			},
		}},
	}

	body, err := json.Marshal(p)
	if err != nil {
		return err
	}

	hc := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, webhookURL, bytes.NewBuffer(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := hc.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("slack webhook returned %d", resp.StatusCode)
	}
	return nil
}
