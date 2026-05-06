package ai

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const (
	groqBaseURL        = "https://api.groq.com/openai/v1"
	groqChatEndpoint   = groqBaseURL + "/chat/completions"
	groqEmbedEndpoint  = groqBaseURL + "/embeddings"
	defaultModel       = "llama-3.3-70b-versatile"
	defaultEmbedModel  = "text-embedding-ada-002"
)

// GroqClient is an HTTP client for the Groq API (OpenAI-compatible).
type GroqClient struct {
	apiKey     string
	httpClient *http.Client
}

// newGroqClient creates a Groq client with a 60-second timeout.
func newGroqClient(apiKey string) *GroqClient {
	return &GroqClient{
		apiKey: apiKey,
		httpClient: &http.Client{
			Timeout: 60 * time.Second,
		},
	}
}

// ── Request / response types ──────────────────────────────────────────────────

type ChatMessage struct {
	Role    string `json:"role"`    // "system" | "user" | "assistant"
	Content string `json:"content"`
}

type ChatRequest struct {
	Model       string        `json:"model"`
	Messages    []ChatMessage `json:"messages"`
	Temperature float64       `json:"temperature"`
	MaxTokens   int           `json:"max_tokens"`
	Stream      bool          `json:"stream"`
}

type ChatResponse struct {
	ID      string `json:"id"`
	Choices []struct {
		Message      ChatMessage `json:"message"`
		FinishReason string      `json:"finish_reason"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
	} `json:"usage"`
}

// StreamDelta is one token chunk from a streaming response.
type StreamDelta struct {
	Content string `json:"content"`
}

type StreamChoice struct {
	Delta        StreamDelta `json:"delta"`
	FinishReason string      `json:"finish_reason"`
}

type StreamChunk struct {
	ID      string         `json:"id"`
	Choices []StreamChoice `json:"choices"`
}

type EmbeddingRequest struct {
	Model string `json:"model"`
	Input string `json:"input"`
}

type EmbeddingResponse struct {
	Data []struct {
		Embedding []float32 `json:"embedding"`
	} `json:"data"`
}

// ── Chat ──────────────────────────────────────────────────────────────────────

// Chat sends a non-streaming chat completion request and returns the full response.
func (c *GroqClient) Chat(ctx context.Context, model string, messages []ChatMessage, temperature float64, maxTokens int) (*ChatResponse, error) {
	req := ChatRequest{
		Model:       orDefault(model, defaultModel),
		Messages:    messages,
		Temperature: temperature,
		MaxTokens:   maxTokens,
		Stream:      false,
	}

	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal chat request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, groqChatEndpoint, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("build chat request: %w", err)
	}
	c.setHeaders(httpReq)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("chat request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		errBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("groq chat returned %d: %s", resp.StatusCode, string(errBody))
	}

	var chatResp ChatResponse
	if err := json.NewDecoder(resp.Body).Decode(&chatResp); err != nil {
		return nil, fmt.Errorf("decode chat response: %w", err)
	}

	return &chatResp, nil
}

// ChatStream sends a streaming chat completion and calls onToken for each token chunk.
// The caller writes tokens directly to the HTTP response via onToken.
func (c *GroqClient) ChatStream(ctx context.Context, model string, messages []ChatMessage, temperature float64, maxTokens int, onToken func(token string) error) error {
	req := ChatRequest{
		Model:       orDefault(model, defaultModel),
		Messages:    messages,
		Temperature: temperature,
		MaxTokens:   maxTokens,
		Stream:      true,
	}

	body, err := json.Marshal(req)
	if err != nil {
		return fmt.Errorf("marshal stream request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, groqChatEndpoint, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("build stream request: %w", err)
	}
	c.setHeaders(httpReq)

	// Use a longer timeout for streaming
	streamClient := &http.Client{Timeout: 5 * time.Minute}
	resp, err := streamClient.Do(httpReq)
	if err != nil {
		return fmt.Errorf("stream request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		errBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("groq stream returned %d: %s", resp.StatusCode, string(errBody))
	}

	// Read SSE stream line by line
	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		line := scanner.Text()

		if !strings.HasPrefix(line, "data: ") {
			continue
		}

		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			break
		}

		var chunk StreamChunk
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			continue
		}

		for _, choice := range chunk.Choices {
			if choice.Delta.Content != "" {
				if err := onToken(choice.Delta.Content); err != nil {
					return err
				}
			}
		}
	}

	return scanner.Err()
}

// ── Embeddings ────────────────────────────────────────────────────────────────

// Embed generates a vector embedding for the given text.
// Returns a float32 slice of length 1536 (text-embedding-ada-002 compatible).
func (c *GroqClient) Embed(ctx context.Context, text string) ([]float32, error) {
	req := EmbeddingRequest{
		Model: defaultEmbedModel,
		Input: text,
	}

	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal embed request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, groqEmbedEndpoint, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("build embed request: %w", err)
	}
	c.setHeaders(httpReq)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("embed request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		errBody, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("groq embed returned %d: %s", resp.StatusCode, string(errBody))
	}

	var embedResp EmbeddingResponse
	if err := json.NewDecoder(resp.Body).Decode(&embedResp); err != nil {
		return nil, fmt.Errorf("decode embed response: %w", err)
	}

	if len(embedResp.Data) == 0 {
		return nil, fmt.Errorf("groq returned empty embedding")
	}

	return embedResp.Data[0].Embedding, nil
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func (c *GroqClient) setHeaders(req *http.Request) {
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
}

func orDefault(val, fallback string) string {
	if val == "" {
		return fallback
	}
	return val
}
