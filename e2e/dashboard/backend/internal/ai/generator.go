package ai

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
)

// TestGenerator produces Playwright TypeScript test cases from plain English descriptions.
type TestGenerator struct {
	rag *RAGPipeline
}

func newTestGenerator(rag *RAGPipeline) *TestGenerator {
	return &TestGenerator{rag: rag}
}

// GeneratedTest is the result of generating a test case.
type GeneratedTest struct {
	FileName    string `json:"file_name"`
	Content     string `json:"content"`     // TypeScript source
	Description string `json:"description"` // AI explanation of what was generated
}

// GenerateTest creates a Playwright TypeScript test from a plain English description.
// Retrieves relevant context from past test cases via RAG to match team conventions.
func (g *TestGenerator) GenerateTest(ctx context.Context, orgID uuid.UUID, description string, subProjectName string, model string, temperature float64) (*GeneratedTest, error) {
	if strings.TrimSpace(description) == "" {
		return nil, fmt.Errorf("description cannot be empty")
	}

	// Retrieve similar existing tests for style reference
	docs, _ := g.rag.Retrieve(ctx, orgID, description)
	contextBlock := g.rag.BuildContext(docs)

	systemPrompt := buildGeneratorSystemPrompt(subProjectName, contextBlock)

	messages := []ChatMessage{
		{Role: "user", Content: buildGeneratorUserPrompt(description)},
	}

	allMessages := append([]ChatMessage{{Role: "system", Content: systemPrompt}}, messages...)

	resp, err := g.rag.groq.Chat(ctx, model, allMessages, temperature, 2048)
	if err != nil {
		return nil, fmt.Errorf("groq generate: %w", err)
	}

	if len(resp.Choices) == 0 {
		return nil, fmt.Errorf("groq returned empty response")
	}

	raw := resp.Choices[0].Message.Content

	// Extract the TypeScript code block from the response
	code, explanation := extractCodeAndExplanation(raw)
	if code == "" {
		// If no code block found, treat the whole response as code
		code = raw
	}

	// Generate a safe filename from the description
	filename := descriptionToFilename(description)

	return &GeneratedTest{
		FileName:    filename,
		Content:     code,
		Description: explanation,
	}, nil
}

// buildGeneratorSystemPrompt creates the system prompt for test generation.
func buildGeneratorSystemPrompt(subProjectName, contextBlock string) string {
	sp := `You are an expert Playwright TypeScript test writer for the Scout QA platform.

Rules for generated tests:
1. Always import from '@playwright/test' only
2. Use process.env.TESTDECK_BASE_URL for the base URL — never hardcode URLs
3. Use process.env.TESTDECK_EMAIL and process.env.TESTDECK_PASSWORD for credentials — never hardcode
4. Use descriptive test names and group related tests in describe blocks
5. Add page.waitForLoadState() after navigation
6. Use getByRole(), getByLabel(), getByText() over CSS selectors where possible
7. Add meaningful expect() assertions
8. Keep tests focused — one feature or flow per test file
9. Add JSDoc comments explaining what the test verifies`

	if subProjectName != "" {
		sp += fmt.Sprintf("\n10. This test is for the '%s' sub-project.", subProjectName)
	}

	if contextBlock != "" {
		sp += "\n\n" + contextBlock
	}

	return sp
}

func buildGeneratorUserPrompt(description string) string {
	return fmt.Sprintf(`Generate a complete Playwright TypeScript test for the following requirement:

%s

Return:
1. A TypeScript code block with the complete test file
2. A brief explanation (2-3 sentences) of what the test covers`, description)
}

// extractCodeAndExplanation splits the AI response into code and explanation parts.
func extractCodeAndExplanation(response string) (code, explanation string) {
	// Look for ```typescript or ```ts code block
	for _, fence := range []string{"```typescript", "```ts", "```javascript", "```js", "```"} {
		start := strings.Index(response, fence)
		if start == -1 {
			continue
		}

		end := strings.Index(response[start+len(fence):], "```")
		if end == -1 {
			continue
		}

		code = strings.TrimSpace(response[start+len(fence) : start+len(fence)+end])

		// Everything before the code block is explanation
		before := strings.TrimSpace(response[:start])
		// Everything after the closing ``` is also explanation
		after := strings.TrimSpace(response[start+len(fence)+end+3:])

		explanation = before
		if after != "" {
			if explanation != "" {
				explanation += "\n\n"
			}
			explanation += after
		}

		return code, explanation
	}

	return "", response
}

// descriptionToFilename converts a plain English description to a valid TypeScript filename.
func descriptionToFilename(description string) string {
	// Take first 6 words
	words := strings.Fields(description)
	if len(words) > 6 {
		words = words[:6]
	}

	var parts []string
	for _, w := range words {
		// Keep only alphanumeric characters
		var clean strings.Builder
		for _, r := range strings.ToLower(w) {
			if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
				clean.WriteRune(r)
			}
		}
		if s := clean.String(); s != "" {
			parts = append(parts, s)
		}
	}

	if len(parts) == 0 {
		return "generated_test.spec.ts"
	}

	return strings.Join(parts, "_") + ".spec.ts"
}
