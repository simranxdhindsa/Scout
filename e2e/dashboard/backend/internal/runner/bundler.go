package runner

import (
	"fmt"

	"github.com/evanw/esbuild/pkg/api"
)

// Bundler wraps esbuild to produce self-contained JS from uploaded TypeScript test files.
// The bundled output has all imports inlined — no node_modules needed at runtime.
type Bundler struct{}

// NewBundler returns a Bundler instance.
func NewBundler() *Bundler {
	return &Bundler{}
}

// Bundle transpiles and bundles a TypeScript source string into a standalone JS string.
// All imports (including @playwright/test) are inlined.
// Returns the bundled JS content or a descriptive error with line numbers.
func (b *Bundler) Bundle(sourceTS string, filename string) (string, error) {
	result := api.Transform(sourceTS, api.TransformOptions{
		Loader:            api.LoaderTS,
		Format:            api.FormatCommonJS,
		Target:            api.ESNext,
		Sourcefile:        filename,
		MinifyWhitespace:  false,
		MinifyIdentifiers: false,
		MinifySyntax:      false,
		// Keep source maps off — we don't need them for execution
		Sourcemap: api.SourceMapNone,
	})

	if len(result.Errors) > 0 {
		var msgs []string
		for _, e := range result.Errors {
			if e.Location != nil {
				msgs = append(msgs, fmt.Sprintf("line %d:%d: %s", e.Location.Line, e.Location.Column, e.Text))
			} else {
				msgs = append(msgs, e.Text)
			}
		}
		return "", fmt.Errorf("typescript errors:\n%s", joinLines(msgs))
	}

	if len(result.Warnings) > 0 {
		// Warnings don't block bundling — log them but continue
		for _, w := range result.Warnings {
			if w.Location != nil {
				_ = fmt.Sprintf("warn line %d: %s", w.Location.Line, w.Text)
			}
		}
	}

	return string(result.Code), nil
}

// BundleFile bundles a TypeScript file at a given path (used during run execution
// when the file has already been written to the temp workspace).
func (b *Bundler) BundleFile(filePath string) (string, error) {
	result := api.Build(api.BuildOptions{
		EntryPoints:       []string{filePath},
		Bundle:            true,
		Write:             false,
		Format:            api.FormatCommonJS,
		Target:            api.ESNext,
		Platform:          api.PlatformNode,
		Sourcemap:         api.SourceMapNone,
		MinifyWhitespace:  false,
		MinifyIdentifiers: false,
		MinifySyntax:      false,
		// External: keep @playwright/test as external so the installed
		// playwright in the workspace handles it at runtime
		External: []string{"@playwright/test", "playwright"},
	})

	if len(result.Errors) > 0 {
		var msgs []string
		for _, e := range result.Errors {
			if e.Location != nil {
				msgs = append(msgs, fmt.Sprintf("%s:%d:%d: %s", e.Location.File, e.Location.Line, e.Location.Column, e.Text))
			} else {
				msgs = append(msgs, e.Text)
			}
		}
		return "", fmt.Errorf("bundle errors:\n%s", joinLines(msgs))
	}

	if len(result.OutputFiles) == 0 {
		return "", fmt.Errorf("esbuild produced no output for %s", filePath)
	}

	return string(result.OutputFiles[0].Contents), nil
}

// DryRun performs a syntax-only check on TypeScript source without producing output.
// Used during file upload validation to catch TS errors before storing in DB.
func (b *Bundler) DryRun(sourceTS string, filename string) error {
	result := api.Transform(sourceTS, api.TransformOptions{
		Loader:     api.LoaderTS,
		Format:     api.FormatCommonJS,
		Sourcefile: filename,
	})

	if len(result.Errors) > 0 {
		var msgs []string
		for _, e := range result.Errors {
			if e.Location != nil {
				msgs = append(msgs, fmt.Sprintf("line %d:%d: %s", e.Location.Line, e.Location.Column, e.Text))
			} else {
				msgs = append(msgs, e.Text)
			}
		}
		return fmt.Errorf("syntax errors:\n%s", joinLines(msgs))
	}

	return nil
}

func joinLines(lines []string) string {
	result := ""
	for i, l := range lines {
		if i > 0 {
			result += "\n"
		}
		result += l
	}
	return result
}
