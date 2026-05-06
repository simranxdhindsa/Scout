package scorm

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// GeneratorMeta holds the DB metadata for one SCORM generator.
type GeneratorMeta struct {
	TypeKey     string
	Name        string
	Category    string // "valid" | "edge" | "break"
	Description string
	Expected    string
	Filename    string
	SortOrder   int
}

// allGenerators is the canonical list of all 30 generators.
// This is the single source of truth — seeded to DB on first startup.
// Org admins can activate/deactivate individual generators from the dashboard.
var allGenerators = []GeneratorMeta{
	// ── VALID ─────────────────────────────────────────────────────────────
	{
		TypeKey:     "valid_scorm12_basic",
		Name:        "SCORM 1.2 Basic",
		Category:    "valid",
		Description: "Standard SCORM 1.2 package with a single SCO — baseline compatibility test.",
		Expected:    "Phoenix should parse manifest, extract one SCO, return coverage > 0.",
		Filename:    "scorm12_basic.zip",
		SortOrder:   10,
	},
	{
		TypeKey:     "valid_scorm2004_basic",
		Name:        "SCORM 2004 Basic",
		Category:    "valid",
		Description: "Standard SCORM 2004 3rd Edition package with a single SCO.",
		Expected:    "Phoenix should parse manifest, extract one SCO, return coverage > 0.",
		Filename:    "scorm2004_basic.zip",
		SortOrder:   20,
	},
	{
		TypeKey:     "valid_multi_sco",
		Name:        "Multi-SCO (3 modules)",
		Category:    "valid",
		Description: "SCORM 1.2 package with 3 separate SCOs representing Introduction, Content, and Assessment.",
		Expected:    "Phoenix should extract 3 SCOs with distinct content sections.",
		Filename:    "multi_sco.zip",
		SortOrder:   30,
	},
	{
		TypeKey:     "valid_lang_fr",
		Name:        "French Language Package",
		Category:    "valid",
		Description: "SCORM 1.2 package with French (fr) HTML content.",
		Expected:    "Phoenix should detect language = fr.",
		Filename:    "lang_fr.zip",
		SortOrder:   40,
	},
	{
		TypeKey:     "valid_lang_es",
		Name:        "Spanish Language Package",
		Category:    "valid",
		Description: "SCORM 1.2 package with Spanish (es) HTML content.",
		Expected:    "Phoenix should detect language = es.",
		Filename:    "lang_es.zip",
		SortOrder:   50,
	},
	{
		TypeKey:     "valid_lang_ja",
		Name:        "Japanese Language Package",
		Category:    "valid",
		Description: "SCORM 1.2 package with Japanese (ja) HTML content including kanji.",
		Expected:    "Phoenix should detect language = ja.",
		Filename:    "lang_ja.zip",
		SortOrder:   60,
	},
	{
		TypeKey:     "valid_lang_de",
		Name:        "German Language Package",
		Category:    "valid",
		Description: "SCORM 1.2 package with German (de) HTML content.",
		Expected:    "Phoenix should detect language = de.",
		Filename:    "lang_de.zip",
		SortOrder:   70,
	},
	{
		TypeKey:     "valid_lang_nl",
		Name:        "Dutch Language Package",
		Category:    "valid",
		Description: "SCORM 1.2 package with Dutch (nl) HTML content.",
		Expected:    "Phoenix should detect language = nl.",
		Filename:    "lang_nl.zip",
		SortOrder:   80,
	},
	{
		TypeKey:     "valid_lang_pt",
		Name:        "Portuguese Language Package",
		Category:    "valid",
		Description: "SCORM 1.2 package with Portuguese (pt) HTML content.",
		Expected:    "Phoenix should detect language = pt.",
		Filename:    "lang_pt.zip",
		SortOrder:   90,
	},
	{
		TypeKey:     "valid_lang_it",
		Name:        "Italian Language Package",
		Category:    "valid",
		Description: "SCORM 1.2 package with Italian (it) HTML content.",
		Expected:    "Phoenix should detect language = it.",
		Filename:    "lang_it.zip",
		SortOrder:   100,
	},
	{
		TypeKey:     "valid_lang_ar",
		Name:        "Arabic Language Package (RTL)",
		Category:    "valid",
		Description: "SCORM 1.2 package with Arabic (ar) RTL HTML content.",
		Expected:    "Phoenix should detect language = ar and handle RTL content.",
		Filename:    "lang_ar.zip",
		SortOrder:   110,
	},
	{
		TypeKey:     "valid_lang_ur",
		Name:        "Urdu Language Package (RTL)",
		Category:    "valid",
		Description: "SCORM 1.2 package with Urdu (ur) RTL HTML content.",
		Expected:    "Phoenix should detect language = ur and handle RTL content.",
		Filename:    "lang_ur.zip",
		SortOrder:   120,
	},
	{
		TypeKey:     "valid_subdirectory",
		Name:        "Subdirectory Layout",
		Category:    "valid",
		Description: "SCORM 1.2 package where the SCO HTML is nested inside a content/ subdirectory with assets.",
		Expected:    "Phoenix should resolve relative paths and extract SCO from content/index.html.",
		Filename:    "subdirectory.zip",
		SortOrder:   130,
	},
	{
		TypeKey:     "valid_pdf_resource",
		Name:        "PDF Resource Package",
		Category:    "valid",
		Description: "SCORM 1.2 package that references a PDF file as an additional resource.",
		Expected:    "Phoenix should extract SCO content and note the PDF resource reference.",
		Filename:    "pdf_resource.zip",
		SortOrder:   140,
	},
	{
		TypeKey:     "valid_external_links",
		Name:        "External Links Package",
		Category:    "valid",
		Description: "SCORM 1.2 package with multiple external hyperlinks in the SCO HTML.",
		Expected:    "Phoenix should extract external_urls list with all 3 links.",
		Filename:    "external_links.zip",
		SortOrder:   150,
	},
	// ── EDGE ──────────────────────────────────────────────────────────────
	{
		TypeKey:     "edge_deeply_nested",
		Name:        "Deeply Nested Paths",
		Category:    "edge",
		Description: "SCO file is 6 directory levels deep (a/b/c/d/e/f/index.html).",
		Expected:    "Phoenix should resolve the deeply nested path and extract the SCO.",
		Filename:    "edge_deeply_nested.zip",
		SortOrder:   210,
	},
	{
		TypeKey:     "edge_large_html",
		Name:        "2MB HTML File",
		Category:    "edge",
		Description: "SCO HTML file is approximately 2MB — stress tests the parser's memory handling.",
		Expected:    "Phoenix should handle large files without timeout or OOM.",
		Filename:    "edge_large_html.zip",
		SortOrder:   220,
	},
	{
		TypeKey:     "edge_missing_resources",
		Name:        "Missing <resources> Tag",
		Category:    "edge",
		Description: "Manifest is missing the <resources> element entirely.",
		Expected:    "Phoenix should return an error or partial result without crashing.",
		Filename:    "edge_missing_resources.zip",
		SortOrder:   230,
	},
	{
		TypeKey:     "edge_empty_html",
		Name:        "Empty HTML Files",
		Category:    "edge",
		Description: "The SCO HTML file exists but is completely empty (0 bytes).",
		Expected:    "Phoenix should handle empty SCO gracefully — coverage = 0 for that SCO.",
		Filename:    "edge_empty_html.zip",
		SortOrder:   240,
	},
	{
		TypeKey:     "edge_xml_comments",
		Name:        "XML Comments in Manifest",
		Category:    "edge",
		Description: "Manifest contains XML comments in unusual positions including inline in element content.",
		Expected:    "Phoenix XML parser should strip comments and parse correctly.",
		Filename:    "edge_xml_comments.zip",
		SortOrder:   250,
	},
	{
		TypeKey:     "edge_windows_paths",
		Name:        "Windows Backslash Paths",
		Category:    "edge",
		Description: "Manifest uses Windows-style backslash separators in href attributes.",
		Expected:    "Phoenix should normalise backslashes to forward slashes.",
		Filename:    "edge_windows_paths.zip",
		SortOrder:   260,
	},
	// ── BREAK ─────────────────────────────────────────────────────────────
	{
		TypeKey:     "break_xss_manifest",
		Name:        "XSS in Manifest",
		Category:    "break",
		Description: "Manifest title and resource attributes contain XSS payloads (<script> tags, CDATA sections).",
		Expected:    "Phoenix should sanitise or escape all output — no XSS should be reflected in results.",
		Filename:    "break_xss_manifest.zip",
		SortOrder:   310,
	},
	{
		TypeKey:     "break_xxe_injection",
		Name:        "XXE Injection",
		Category:    "break",
		Description: "Manifest DOCTYPE declares external entities targeting /etc/passwd and a remote URL.",
		Expected:    "Phoenix XML parser should reject external entities — no file read or SSRF.",
		Filename:    "break_xxe_injection.zip",
		SortOrder:   320,
	},
	{
		TypeKey:     "break_zip_slip",
		Name:        "ZIP Slip Path Traversal",
		Category:    "break",
		Description: "ZIP contains entries with ../../ path traversal filenames to escape the extraction directory.",
		Expected:    "Phoenix extractor should reject traversal paths — no files written outside sandbox.",
		Filename:    "break_zip_slip.zip",
		SortOrder:   330,
	},
	{
		TypeKey:     "break_dom_xss",
		Name:        "DOM XSS Vectors",
		Category:    "break",
		Description: "SCO HTML contains multiple DOM XSS attack vectors: innerHTML, eval, document.write, external script.",
		Expected:    "Phoenix should extract text content without executing scripts.",
		Filename:    "break_dom_xss.zip",
		SortOrder:   340,
	},
	{
		TypeKey:     "break_billion_laughs",
		Name:        "XML Billion Laughs DoS",
		Category:    "break",
		Description: "Manifest uses recursive XML entity expansion (Billion Laughs) to cause DoS.",
		Expected:    "Phoenix should reject or timeout on entity expansion — no OOM crash.",
		Filename:    "break_billion_laughs.zip",
		SortOrder:   350,
	},
	{
		TypeKey:     "break_css_exfil",
		Name:        "CSS Exfiltration Attack",
		Category:    "break",
		Description: "SCO HTML uses CSS attribute selectors with external background URLs to exfiltrate data.",
		Expected:    "Phoenix should extract text content without making external CSS requests.",
		Filename:    "break_css_exfil.zip",
		SortOrder:   360,
	},
	{
		TypeKey:     "break_overlong_strings",
		Name:        "Overlong Strings (Buffer Overflow)",
		Category:    "break",
		Description: "Manifest title field contains a 100KB+ string to test buffer overflow handling.",
		Expected:    "Phoenix should truncate or reject overlong fields — no memory corruption.",
		Filename:    "break_overlong_strings.zip",
		SortOrder:   370,
	},
	{
		TypeKey:     "break_null_byte",
		Name:        "Null Byte Injection",
		Category:    "break",
		Description: "Filename in manifest href contains a null byte (index.html\\x00.html).",
		Expected:    "Phoenix should reject null bytes in paths — no file system confusion.",
		Filename:    "break_null_byte.zip",
		SortOrder:   380,
	},
	{
		TypeKey:     "break_path_traversal_ssrf",
		Name:        "Path Traversal + SSRF hrefs",
		Category:    "break",
		Description: "SCO HTML contains hrefs targeting file://, internal IPs (AWS metadata), localhost ports, and gopher://.",
		Expected:    "Phoenix should not follow dangerous hrefs — no SSRF or local file read.",
		Filename:    "break_path_traversal_ssrf.zip",
		SortOrder:   390,
	},
	{
		TypeKey:     "break_unicode_bidi",
		Name:        "Unicode BiDi Override + Homograph",
		Category:    "break",
		Description: "Manifest contains Unicode right-to-left override characters and Cyrillic homograph attacks in titles.",
		Expected:    "Phoenix should sanitise Unicode control characters in text output.",
		Filename:    "break_unicode_bidi.zip",
		SortOrder:   400,
	},
}

// SeedGenerators inserts all generator metadata into the scorm_generators table.
// Uses ON CONFLICT DO UPDATE to refresh description/expected text on redeploy.
// Idempotent — safe to call on every server startup.
func SeedGenerators(ctx context.Context, db *pgxpool.Pool) error {
	for _, g := range allGenerators {
		_, err := db.Exec(ctx, `
			INSERT INTO scorm_generators
			  (type_key, name, category, description, expected, filename, sort_order)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
			ON CONFLICT (type_key) DO UPDATE
			  SET name        = EXCLUDED.name,
			      category    = EXCLUDED.category,
			      description = EXCLUDED.description,
			      expected    = EXCLUDED.expected,
			      filename    = EXCLUDED.filename,
			      sort_order  = EXCLUDED.sort_order
		`, g.TypeKey, g.Name, g.Category, g.Description, g.Expected, g.Filename, g.SortOrder)
		if err != nil {
			return fmt.Errorf("seed generator %s: %w", g.TypeKey, err)
		}
	}
	return nil
}
