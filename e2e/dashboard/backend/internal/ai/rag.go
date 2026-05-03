package ai

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
)

const (
	ragTopK          = 5    // number of context documents to retrieve
	ragMinSimilarity = 0.70 // discard results below this cosine similarity
	ragMaxContextLen = 3000 // max characters of context to inject into prompt
)

// RAGPipeline orchestrates the full Retrieve-Augment-Generate flow.
type RAGPipeline struct {
	embeddings  *EmbeddingService
	vectorStore *VectorStore
	groq        *GroqClient
}

func newRAGPipeline(embeddings *EmbeddingService, vectorStore *VectorStore, groq *GroqClient) *RAGPipeline {
	return &RAGPipeline{
		embeddings:  embeddings,
		vectorStore: vectorStore,
		groq:        groq,
	}
}

// Index chunks and embeds a piece of content and stores it in the vector store.
// sourceType: "test_case" | "run_report" | "run_error" | "manual"
func (r *RAGPipeline) Index(ctx context.Context, orgID uuid.UUID, sourceType string, sourceID *uuid.UUID, content string) error {
	chunks, err := r.embeddings.EmbedChunks(ctx, content)
	if err != nil {
		return fmt.Errorf("embed chunks: %w", err)
	}

	for _, chunk := range chunks {
		if _, err := r.vectorStore.Insert(ctx, orgID, sourceType, sourceID, chunk.Text, chunk.Embedding); err != nil {
			return fmt.Errorf("insert chunk %d: %w", chunk.Index, err)
		}
	}

	return nil
}

// Retrieve finds the most relevant documents for a query string.
func (r *RAGPipeline) Retrieve(ctx context.Context, orgID uuid.UUID, query string) ([]RAGDocument, error) {
	queryVec, err := r.embeddings.Embed(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("embed query: %w", err)
	}

	docs, err := r.vectorStore.Search(ctx, orgID, queryVec, ragTopK)
	if err != nil {
		return nil, fmt.Errorf("vector search: %w", err)
	}

	// Filter by minimum similarity threshold
	var filtered []RAGDocument
	for _, d := range docs {
		if d.Similarity >= ragMinSimilarity {
			filtered = append(filtered, d)
		}
	}

	return filtered, nil
}

// BuildContext formats retrieved documents into a context block for injection into prompts.
func (r *RAGPipeline) BuildContext(docs []RAGDocument) string {
	if len(docs) == 0 {
		return ""
	}

	var sb strings.Builder
	sb.WriteString("### Relevant context from your QA history:\n\n")

	totalLen := 0
	for i, doc := range docs {
		entry := fmt.Sprintf("**[%d] %s** (similarity: %.0f%%)\n%s\n\n",
			i+1, doc.SourceType, doc.Similarity*100, doc.Content)

		if totalLen+len(entry) > ragMaxContextLen {
			break
		}

		sb.WriteString(entry)
		totalLen += len(entry)
	}

	return sb.String()
}

// AugmentedChat performs a full RAG chat:
// 1. Retrieves relevant context from the vector store
// 2. Prepends context to the user's messages
// 3. Calls Groq for a non-streaming response
func (r *RAGPipeline) AugmentedChat(ctx context.Context, orgID uuid.UUID, systemPrompt string, messages []ChatMessage, model string, temperature float64, maxTokens int) (*ChatResponse, error) {
	// Get last user message for retrieval query
	query := lastUserMessage(messages)

	// Retrieve relevant context
	docs, err := r.Retrieve(ctx, orgID, query)
	if err != nil {
		// RAG failure is non-fatal — fall back to plain chat
		docs = nil
	}

	// Build augmented messages
	augmented := buildAugmentedMessages(systemPrompt, messages, docs)

	return r.groq.Chat(ctx, model, augmented, temperature, maxTokens)
}

// AugmentedChatStream performs RAG-augmented streaming chat.
// Calls onToken for each streamed token chunk.
func (r *RAGPipeline) AugmentedChatStream(ctx context.Context, orgID uuid.UUID, systemPrompt string, messages []ChatMessage, model string, temperature float64, maxTokens int, onToken func(string) error) error {
	query := lastUserMessage(messages)

	docs, err := r.Retrieve(ctx, orgID, query)
	if err != nil {
		docs = nil
	}

	augmented := buildAugmentedMessages(systemPrompt, messages, docs)

	return r.groq.ChatStream(ctx, model, augmented, temperature, maxTokens, onToken)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func lastUserMessage(messages []ChatMessage) string {
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].Role == "user" {
			return messages[i].Content
		}
	}
	return ""
}

func buildAugmentedMessages(systemPrompt string, messages []ChatMessage, docs []RAGDocument) []ChatMessage {
	var result []ChatMessage

	// System prompt
	sysContent := systemPrompt
	if sysContent == "" {
		sysContent = defaultSystemPrompt()
	}

	// Append RAG context to system prompt if available
	if len(docs) > 0 {
		contextBlock := buildContextBlock(docs)
		sysContent = sysContent + "\n\n" + contextBlock
	}

	result = append(result, ChatMessage{Role: "system", Content: sysContent})
	result = append(result, messages...)

	return result
}

func buildContextBlock(docs []RAGDocument) string {
	var sb strings.Builder
	sb.WriteString("### Relevant context from QA history:\n\n")

	totalLen := 0
	for i, doc := range docs {
		entry := fmt.Sprintf("[%d] Source: %s\n%s\n\n", i+1, doc.SourceType, doc.Content)
		if totalLen+len(entry) > ragMaxContextLen {
			break
		}
		sb.WriteString(entry)
		totalLen += len(entry)
	}

	return sb.String()
}

func defaultSystemPrompt() string {
	return `You are Scout AI, an expert QA automation assistant for the Scout platform at ApyHub.
You help QA engineers analyse test failures, generate Playwright test cases, and understand test results.
You have access to the team's historical test data and run reports as context.
Be concise, technical, and actionable. Format code in markdown code blocks.`
}
