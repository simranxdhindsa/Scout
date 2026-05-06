package ai

import (
	"context"
	"fmt"
	"strings"
	"unicode/utf8"
)

const (
	maxChunkSize    = 512  // tokens (approximate — we use chars / 4)
	chunkOverlap    = 64   // overlap between consecutive chunks
	maxChunkChars   = maxChunkSize * 4
	overlapChars    = chunkOverlap * 4
)

// EmbeddingService wraps the Groq client for embedding-specific operations.
type EmbeddingService struct {
	client *GroqClient
}

func newEmbeddingService(client *GroqClient) *EmbeddingService {
	return &EmbeddingService{client: client}
}

// Embed generates a single embedding vector for the given text.
func (e *EmbeddingService) Embed(ctx context.Context, text string) ([]float32, error) {
	text = cleanText(text)
	if text == "" {
		return nil, fmt.Errorf("cannot embed empty text")
	}
	return e.client.Embed(ctx, text)
}

// EmbedChunks splits text into overlapping chunks and returns one embedding per chunk.
// Used when indexing long documents like test files or run error logs.
func (e *EmbeddingService) EmbedChunks(ctx context.Context, text string) ([]ChunkedEmbedding, error) {
	text = cleanText(text)
	if text == "" {
		return nil, fmt.Errorf("cannot embed empty text")
	}

	chunks := splitIntoChunks(text)
	results := make([]ChunkedEmbedding, 0, len(chunks))

	for i, chunk := range chunks {
		vec, err := e.client.Embed(ctx, chunk)
		if err != nil {
			return nil, fmt.Errorf("embed chunk %d: %w", i, err)
		}
		results = append(results, ChunkedEmbedding{
			Index:     i,
			Text:      chunk,
			Embedding: vec,
		})
	}

	return results, nil
}

// ChunkedEmbedding pairs a text chunk with its embedding vector.
type ChunkedEmbedding struct {
	Index     int
	Text      string
	Embedding []float32
}

// splitIntoChunks divides text into overlapping chunks suitable for embedding.
// Uses a sliding window with overlap to preserve context at boundaries.
func splitIntoChunks(text string) []string {
	if utf8.RuneCountInString(text) <= maxChunkChars {
		return []string{text}
	}

	runes := []rune(text)
	var chunks []string
	start := 0

	for start < len(runes) {
		end := start + maxChunkChars
		if end > len(runes) {
			end = len(runes)
		}

		// Try to break on a sentence or paragraph boundary
		chunk := string(runes[start:end])
		if end < len(runes) {
			if idx := lastSentenceBoundary(chunk); idx > 0 {
				chunk = chunk[:idx]
				end = start + idx
			}
		}

		chunks = append(chunks, strings.TrimSpace(chunk))

		// Advance with overlap
		next := end - overlapChars
		if next <= start {
			next = start + 1
		}
		start = next
	}

	return chunks
}

// lastSentenceBoundary returns the index of the last sentence-ending punctuation
// followed by whitespace, for clean chunk boundaries.
func lastSentenceBoundary(s string) int {
	runes := []rune(s)
	for i := len(runes) - 1; i > len(runes)/2; i-- {
		r := runes[i]
		if (r == '.' || r == '!' || r == '?' || r == '\n') && i+1 < len(runes) {
			if runes[i+1] == ' ' || runes[i+1] == '\n' {
				return i + 1
			}
		}
	}
	return 0
}

// cleanText normalises text before embedding:
// - collapses multiple blank lines
// - trims leading/trailing whitespace
// - removes null bytes
func cleanText(s string) string {
	// Remove null bytes
	s = strings.ReplaceAll(s, "\x00", "")

	// Collapse 3+ consecutive newlines → 2
	for strings.Contains(s, "\n\n\n") {
		s = strings.ReplaceAll(s, "\n\n\n", "\n\n")
	}

	return strings.TrimSpace(s)
}
