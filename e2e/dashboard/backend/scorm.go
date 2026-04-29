package main

import (
	"archive/zip"
	"bytes"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

const (
	ScormUpstreamBase = "http://phoenix.private.ardoirse.com"
	ScormPort         = ":8080"
)

var scormDBPath string

// ── Models ──────────────────────────────────────────────────────────────────

type Snapshot struct {
	ID             string      `json:"id"`
	Filename       string      `json:"filename"`
	FileSize       int64       `json:"file_size"`
	JobID          string      `json:"job_id"`
	GeneratorType  string      `json:"generator_type,omitempty"`
	TestCategory   string      `json:"test_category"`
	Notes          string      `json:"notes,omitempty"`
	UploadedAt     time.Time   `json:"uploaded_at"`
	CompletedAt    *time.Time  `json:"completed_at,omitempty"`
	Status         string      `json:"status"`
	UploadResponse interface{} `json:"upload_response"`
	StatusResponse interface{} `json:"status_response,omitempty"`
}

type scormDB struct {
	Snapshots []Snapshot `json:"snapshots"`
}

var (
	scormDBMu   sync.RWMutex
	scormDBData scormDB
)

// ── DB helpers ───────────────────────────────────────────────────────────────

func initScorm(baseDir string) {
	scormDBPath = baseDir + "/scorm_db.json"
	loadScormDB()
}

func loadScormDB() {
	data, err := os.ReadFile(scormDBPath)
	if err != nil {
		scormDBData = scormDB{Snapshots: []Snapshot{}}
		return
	}
	if err := json.Unmarshal(data, &scormDBData); err != nil {
		scormDBData = scormDB{Snapshots: []Snapshot{}}
	}
}

func persistScormDB() {
	scormDBMu.RLock()
	copy := scormDBData
	scormDBMu.RUnlock()
	data, _ := json.MarshalIndent(copy, "", "  ")
	os.WriteFile(scormDBPath, data, 0644)
}

// ── Utilities ────────────────────────────────────────────────────────────────

func scormUUID() string {
	b := make([]byte, 16)
	rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}

func scormJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func scormErr(w http.ResponseWriter, status int, msg string) {
	scormJSON(w, status, map[string]string{"error": msg})
}

// ── Route registration ───────────────────────────────────────────────────────

func registerScormRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/api/scorm/upload", handleScormUpload)
	mux.HandleFunc("/api/scorm/status/", handleScormStatus)
	mux.HandleFunc("/api/scorm/snapshots", handleScormSnapshots)
	mux.HandleFunc("/api/scorm/snapshots/", handleScormSnapshots)
	mux.HandleFunc("/api/scorm/generate/", handleScormGenerate)
}

// ── Handler: POST /api/scorm/upload ─────────────────────────────────────────

func handleScormUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		scormErr(w, 405, "method not allowed")
		return
	}

	if err := r.ParseMultipartForm(200 << 20); err != nil {
		scormErr(w, 400, "parse multipart failed: "+err.Error())
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		scormErr(w, 400, "missing 'file' field: "+err.Error())
		return
	}
	defer file.Close()

	fileBytes, err := io.ReadAll(file)
	if err != nil {
		scormErr(w, 500, "read file failed: "+err.Error())
		return
	}

	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	part, err := mw.CreateFormFile("file", header.Filename)
	if err != nil {
		scormErr(w, 500, "create form file: "+err.Error())
		return
	}
	part.Write(fileBytes)
	mw.Close()

	req, err := http.NewRequest("POST", ScormUpstreamBase+"/upload", &body)
	if err != nil {
		scormErr(w, 500, "build upstream request: "+err.Error())
		return
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())

	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		scormErr(w, 502, "upstream unreachable: "+err.Error())
		return
	}
	defer resp.Body.Close()

	respBytes, _ := io.ReadAll(resp.Body)
	var rawResp interface{}
	json.Unmarshal(respBytes, &rawResp)

	var upResp struct {
		JobID  string `json:"job_id"`
		Cached bool   `json:"cached"`
	}
	json.Unmarshal(respBytes, &upResp)

	snapshotID := scormUUID()
	testCategory := r.FormValue("test_category")
	if testCategory == "" {
		testCategory = "valid"
	}

	snap := Snapshot{
		ID:             snapshotID,
		Filename:       header.Filename,
		FileSize:       header.Size,
		JobID:          upResp.JobID,
		GeneratorType:  r.FormValue("generator_type"),
		TestCategory:   testCategory,
		Notes:          r.FormValue("notes"),
		UploadedAt:     time.Now().UTC(),
		Status:         "uploaded",
		UploadResponse: rawResp,
	}

	scormDBMu.Lock()
	scormDBData.Snapshots = append([]Snapshot{snap}, scormDBData.Snapshots...)
	scormDBMu.Unlock()
	go persistScormDB()

	log.Printf("[SCORM UPLOAD] file=%s job_id=%s category=%s", header.Filename, upResp.JobID, testCategory)

	scormJSON(w, 200, map[string]interface{}{
		"snapshot_id":     snapshotID,
		"job_id":          upResp.JobID,
		"cached":          upResp.Cached,
		"upstream_status": resp.StatusCode,
	})
}

// ── Handler: GET /api/scorm/status/{job_id} ──────────────────────────────────

func handleScormStatus(w http.ResponseWriter, r *http.Request) {
	jobID := strings.TrimPrefix(r.URL.Path, "/api/scorm/status/")
	if jobID == "" {
		scormErr(w, 400, "missing job_id")
		return
	}
	snapshotID := r.URL.Query().Get("snapshot_id")

	resp, err := http.Get(ScormUpstreamBase + "/status/" + jobID)
	if err != nil {
		scormErr(w, 502, "upstream unreachable: "+err.Error())
		return
	}
	defer resp.Body.Close()

	respBytes, _ := io.ReadAll(resp.Body)

	var statusResp map[string]interface{}
	json.Unmarshal(respBytes, &statusResp)

	if snapshotID != "" {
		status, _ := statusResp["status"].(string)
		if status == "complete" || status == "error" || status == "failed" {
			now := time.Now().UTC()
			scormDBMu.Lock()
			for i, s := range scormDBData.Snapshots {
				if s.ID == snapshotID {
					scormDBData.Snapshots[i].Status = status
					scormDBData.Snapshots[i].CompletedAt = &now
					scormDBData.Snapshots[i].StatusResponse = statusResp
					break
				}
			}
			scormDBMu.Unlock()
			go persistScormDB()
			log.Printf("[SCORM STATUS] job_id=%s status=%s", jobID, status)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	w.Write(respBytes)
}

// ── Handler: GET /api/scorm/snapshots  &  DELETE /api/scorm/snapshots/{id} ──

func handleScormSnapshots(w http.ResponseWriter, r *http.Request) {
	id := ""
	if r.URL.Path != "/api/scorm/snapshots" {
		id = strings.TrimPrefix(r.URL.Path, "/api/scorm/snapshots/")
	}

	switch {
	case r.Method == http.MethodGet && id == "":
		scormDBMu.RLock()
		snaps := scormDBData.Snapshots
		scormDBMu.RUnlock()
		if snaps == nil {
			snaps = []Snapshot{}
		}
		scormJSON(w, 200, snaps)

	case r.Method == http.MethodDelete && id != "":
		scormDBMu.Lock()
		for i, s := range scormDBData.Snapshots {
			if s.ID == id {
				scormDBData.Snapshots = append(scormDBData.Snapshots[:i], scormDBData.Snapshots[i+1:]...)
				break
			}
		}
		scormDBMu.Unlock()
		go persistScormDB()
		scormJSON(w, 200, map[string]string{"status": "deleted", "id": id})

	default:
		scormErr(w, 405, "method not allowed")
	}
}

// ── Generator registry ───────────────────────────────────────────────────────

type GenMeta struct {
	Type        string `json:"type"`
	Name        string `json:"name"`
	Category    string `json:"category"`
	Description string `json:"description"`
	Expected    string `json:"expected"`
	Filename    string `json:"filename"`
}

var scormRegistry = []GenMeta{
	// Valid SCORMs
	{"minimal-scorm12", "Minimal SCORM 1.2", "valid",
		"One SCO, flat structure, imsmanifest.xml + index.html. Mirrors Test_SCORM_7KB pattern.",
		"status:complete, 1 markdown extracted", "minimal_scorm12.zip"},

	{"minimal-scorm2004", "Minimal SCORM 2004 3rd Ed", "valid",
		"SCORM 2004 namespace declarations, adlseq schema, single SCO.",
		"status:complete, 1 markdown extracted", "minimal_scorm2004.zip"},

	{"multi-sco-8ch", "Multi-SCO 8 Chapters", "valid",
		"8 separate SCOs each in their own subfolder. Mirrors the full Ardoise course structure.",
		"multiple markdowns, high coverage_percent", "multi_sco_8ch.zip"},

	{"subdirectory-layout", "Subdirectory Layout", "valid",
		"Resources inside a named parent folder (like Ardoise_Fundamentals_Digital_Literacy/).",
		"Paths resolved correctly, content extracted", "subdirectory_layout.zip"},

	{"with-pdf-resource", "SCORM + PDF Resource", "valid",
		"imsmanifest references a PDF inside /resources/ folder.",
		"PDF detected in content_types, text extracted", "with_pdf.zip"},

	{"external-links", "SCORM with External Links", "valid",
		"HTML content with multiple <a href> pointing to external URLs (https).",
		"external_links[] populated in response", "external_links.zip"},

	{"multilingual-fr", "French Content (fr-FR)", "valid",
		"Full SCORM with French HTML text. Tests language auto-detection.",
		"language:fr-FR detected", "multilingual_fr.zip"},

	{"multilingual-es", "Spanish Content (es-ES)", "valid",
		"Full SCORM with Spanish HTML text. Tests language auto-detection.",
		"language:es-ES detected", "multilingual_es.zip"},

	{"multilingual-ja", "Japanese Content (ja-JP)", "valid",
		"Full SCORM with Japanese HTML text. Tests language auto-detection.",
		"language:ja-JP detected", "multilingual_ja.zip"},

	{"multilingual-de", "German Content (de-DE)", "valid",
		"Full SCORM with German HTML text. Tests language auto-detection.",
		"language:de-DE detected", "multilingual_de.zip"},

	{"multilingual-nl", "Dutch Content (nl-NL)", "valid",
		"Full SCORM with Dutch HTML text. Tests language auto-detection.",
		"language:nl-NL detected", "multilingual_nl.zip"},

	{"multilingual-pt", "Portuguese Content (pt-PT)", "valid",
		"Full SCORM with European Portuguese HTML text. Tests language auto-detection.",
		"language:pt-PT detected", "multilingual_pt.zip"},

	{"multilingual-it", "Italian Content (it-IT)", "valid",
		"Full SCORM with Italian HTML text. Tests language auto-detection.",
		"language:it-IT detected", "multilingual_it.zip"},

	{"multilingual-ar", "Arabic RTL (ar-SA)", "valid",
		"SCORM with Arabic text and dir=rtl. Tests RTL language detection.",
		"language:ar-SA detected", "multilingual_ar.zip"},

	{"multilingual-ur", "Urdu Content (ur-IN)", "valid",
		"SCORM with Urdu (Nastaliq) text. Tests ur-IN detection.",
		"language:ur-IN detected", "multilingual_ur.zip"},

	// Edge Cases
	{"deeply-nested", "Deeply Nested (5 levels)", "edge",
		"Resources buried 5 folder levels deep. Tests path resolution.",
		"Should still extract content", "deeply_nested.zip"},

	{"huge-html-2mb", "Huge HTML (~2MB)", "edge",
		"Single HTML file with ~2MB of repeated paragraph content. Stress test.",
		"Complete but may take longer, high token count", "huge_html_2mb.zip"},

	{"no-resources-tag", "Manifest Without <resources>", "edge",
		"Valid XML manifest with organizations but <resources> tag completely absent.",
		"Error or empty extraction — tests manifest parser", "no_resources_tag.zip"},

	{"empty-html-files", "SCORM with Empty HTML Files", "edge",
		"Valid manifest, HTML files exist in ZIP but are 0 bytes.",
		"Empty markdown or error on content extraction", "empty_html_files.zip"},

	{"scorm-with-comments", "Manifest with XML Comments", "edge",
		"imsmanifest.xml heavily commented. Tests XML parser robustness.",
		"Should parse correctly despite comments", "with_comments.zip"},

	{"windows-paths", "Windows Backslash Paths", "edge",
		"imsmanifest.xml uses Windows-style backslash paths (resources\\file.html).",
		"Path normalization test", "windows_paths.zip"},

	// Break Tests
	{"empty-zip", "Empty ZIP", "break",
		"Valid ZIP magic bytes, valid structure, zero files inside.",
		"Error: no content / no manifest found", "empty.zip"},

	{"no-manifest", "ZIP Without imsmanifest.xml", "break",
		"Real ZIP with only HTML files — no imsmanifest.xml at all.",
		"Error: manifest not found", "no_manifest.zip"},

	{"corrupt-zip", "Corrupt ZIP (random bytes)", "break",
		"File with .zip extension but random garbage bytes — invalid ZIP magic.",
		"Error: not a valid ZIP / parse failure", "corrupt.zip"},

	{"malformed-xml", "Malformed Manifest XML", "break",
		"ZIP with imsmanifest.xml containing broken XML (unclosed tags, bad encoding).",
		"Error: XML parse failure", "malformed_xml.zip"},

	{"binary-as-html", "Binary Garbage as HTML", "break",
		"Valid manifest + .html file containing random binary bytes (not text).",
		"Error or empty markdown — tests content decoder", "binary_html.zip"},

	{"renamed-pdf-as-zip", "PDF Renamed as .zip", "break",
		"A minimal PDF file with .zip extension. Wrong magic bytes entirely.",
		"Error: invalid ZIP format (PDF magic %PDF-)", "renamed_pdf.zip"},

	{"zero-byte-file", "Zero Byte File", "break",
		"Completely empty 0-byte file uploaded as ZIP.",
		"Error: empty file / EOF", "zero_byte.zip"},

	{"nested-zip-bomb", "Nested ZIP in ZIP", "break",
		"A ZIP containing another ZIP containing another ZIP (3 levels deep).",
		"Should not recursively explode — tests ZIP bomb protection", "nested_zip.zip"},

	{"no-field-name", "Wrong Form Field Name", "break",
		"File uploaded with field name 'upload' instead of 'file'.",
		"Error: missing 'file' field", "test_scorm12_valid.zip"},
}

// ── ZIP build helpers ────────────────────────────────────────────────────────

func buildZIP(files map[string][]byte) ([]byte, error) {
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	for name, content := range files {
		f, err := w.Create(name)
		if err != nil {
			return nil, err
		}
		f.Write(content)
	}
	w.Close()
	return buf.Bytes(), nil
}

func bs(str string) []byte { return []byte(str) }

func scorm12Manifest(id, orgID, title string, items []string, resources []string) string {
	return fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="%s" version="1.2"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd
                      http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="%s">
    <organization identifier="%s">
      <title>%s</title>
      %s
    </organization>
  </organizations>
  <resources>
    %s
  </resources>
</manifest>`, id, orgID, orgID, title,
		strings.Join(items, "\n      "),
		strings.Join(resources, "\n    "))
}

func scorm12Item(id, ref, title string) string {
	return fmt.Sprintf(`<item identifier="%s" identifierref="%s"><title>%s</title></item>`, id, ref, title)
}

func scorm12Resource(id, href string, files []string) string {
	fileEntries := make([]string, len(files))
	for i, f := range files {
		fileEntries[i] = fmt.Sprintf(`<file href="%s"/>`, f)
	}
	return fmt.Sprintf(`<resource identifier="%s" type="webcontent" adlcp:scormtype="sco" href="%s">%s</resource>`,
		id, href, strings.Join(fileEntries, ""))
}

func htmlPage(lang, title, body string) string {
	return fmt.Sprintf(`<!DOCTYPE html>
<html lang="%s">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>%s</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 24px; color: #1a2a3a; }
    h1, h2 { color: #1a3a5c; }
    ul { margin: 12px 0 12px 24px; }
    li { margin: 6px 0; }
    .summary { background: #f0f4f8; border-left: 4px solid #2d6a9f; padding: 12px 16px; margin: 16px 0; }
  </style>
</head>
<body>
%s
</body>
</html>`, lang, title, body)
}

// ── Generators ───────────────────────────────────────────────────────────────

func genMinimalSCORM12() ([]byte, error) {
	manifest := scorm12Manifest("TEST_MINIMAL_SCORM12", "org1", "Minimal SCORM 1.2 Test Course",
		[]string{scorm12Item("item1", "res1", "Chapter 1: Introduction")},
		[]string{scorm12Resource("res1", "index.html", []string{"index.html"})},
	)
	body := `<h1>Chapter 1: Introduction to SCORM</h1>
<p>This is a minimal SCORM 1.2 test package created for the SCORM Scraper QA suite.</p>
<h2>Learning Objectives</h2>
<ul>
  <li>Understand SCORM 1.2 package structure</li>
  <li>Verify imsmanifest.xml parsing</li>
  <li>Confirm HTML content extraction</li>
</ul>
<h2>What is SCORM?</h2>
<p>SCORM (Sharable Content Object Reference Model) is a set of technical standards for eLearning software products. It defines how online learning content and learning management systems communicate with each other.</p>
<h2>Key Components</h2>
<ul>
  <li><strong>imsmanifest.xml</strong> — the course structure definition</li>
  <li><strong>SCO (Shareable Content Object)</strong> — individual learning units</li>
  <li><strong>LMS</strong> — Learning Management System that hosts SCORM courses</li>
</ul>
<div class="summary"><strong>Summary:</strong> This package validates that the scraping service correctly identifies and extracts a single-SCO SCORM 1.2 course.</div>`
	return buildZIP(map[string][]byte{
		"imsmanifest.xml": bs(manifest),
		"index.html":      bs(htmlPage("en", "Chapter 1: Introduction to SCORM", body)),
	})
}

func genMinimalSCORM2004() ([]byte, error) {
	manifest := `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="TEST_SCORM2004" version="1"
  xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"
  xmlns:adlseq="http://www.adlnet.org/xsd/adlseq_v1p3"
  xmlns:adlnav="http://www.adlnet.org/xsd/adlnav_v1p3"
  xmlns:imsss="http://www.imsglobal.org/xsd/imsss"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsglobal.org/xsd/imscp_v1p1 imscp_v1p1.xsd
                      http://www.adlnet.org/xsd/adlcp_v1p3 adlcp_v1p3.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>2004 3rd Edition</schemaversion>
  </metadata>
  <organizations default="org_2004">
    <organization identifier="org_2004" adlseq:objectivesGlobalToSystem="false">
      <title>SCORM 2004 Test Course</title>
      <item identifier="item1" identifierref="res1">
        <title>Module 1: SCORM 2004 Basics</title>
        <imsss:sequencing><imsss:deliveryControls completionSetByContent="true" objectiveSetByContent="true"/></imsss:sequencing>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="res1" type="webcontent" adlcp:scormType="sco" href="index.html">
      <file href="index.html"/>
    </resource>
  </resources>
</manifest>`
	body := `<h1>Module 1: SCORM 2004 Basics</h1>
<p>This package tests SCORM 2004 3rd Edition parsing. The namespace declarations differ from SCORM 1.2 and include adlseq and imsss schemas.</p>
<h2>Differences from SCORM 1.2</h2>
<ul>
  <li>Uses <code>adlcp:scormType</code> (camelCase) instead of <code>adlcp:scormtype</code></li>
  <li>Includes sequencing and navigation schemas</li>
  <li>Different namespace URIs throughout manifest</li>
</ul>
<div class="summary"><strong>Test goal:</strong> Verify the scraper handles SCORM 2004 namespace differences correctly.</div>`
	return buildZIP(map[string][]byte{
		"imsmanifest.xml": bs(manifest),
		"index.html":      bs(htmlPage("en", "SCORM 2004 Module 1", body)),
	})
}

func genMultiSCO8Ch() ([]byte, error) {
	chapters := []struct{ title, content string }{
		{"Introduction to Digital Literacy", "Digital literacy is the ability to use information and communication technologies effectively. It encompasses skills needed to live, learn, and work in a society where communication and access to information is increasingly through digital technologies."},
		{"File Management Fundamentals", "Effective file management includes organizing documents in logical folder structures, naming files consistently, using version control, and maintaining regular backups."},
		{"Internet and Web Browsing", "Modern web browsers provide tools for bookmarking, private browsing, developer tools, and extension management. Understanding how URLs work and how to evaluate website credibility are core digital literacy skills."},
		{"Email Communication Skills", "Professional email writing requires clear subject lines, appropriate salutations, concise body text, and proper sign-offs."},
		{"Cloud Storage and Collaboration", "Cloud platforms like Google Drive, OneDrive, and Dropbox enable real-time collaboration."},
		{"Cybersecurity Basics", "Strong passwords, multi-factor authentication, recognizing phishing attempts, and keeping software updated are foundational cybersecurity practices."},
		{"Productivity Software", "Spreadsheets, word processors, and presentation tools form the productivity software toolkit."},
		{"Digital Wellness and Ethics", "Responsible technology use includes respecting intellectual property, understanding digital footprints, managing screen time, and practicing netiquette."},
	}

	items := make([]string, len(chapters))
	resources := make([]string, len(chapters))
	files := map[string][]byte{}

	for i, ch := range chapters {
		chNum := i + 1
		itemID := fmt.Sprintf("item%d", chNum)
		resID := fmt.Sprintf("res%d", chNum)
		htmlFile := fmt.Sprintf("ch%02d/index.html", chNum)

		items[i] = scorm12Item(itemID, resID, fmt.Sprintf("Chapter %d: %s", chNum, ch.title))
		resources[i] = scorm12Resource(resID, htmlFile, []string{htmlFile})

		body := fmt.Sprintf(`<h1>Chapter %d: %s</h1>
<p>%s</p>
<h2>Learning Objectives</h2>
<ul>
  <li>Understand core concepts of %s</li>
  <li>Apply skills in real-world scenarios</li>
</ul>
<div class="summary"><strong>Chapter Summary:</strong> %s provides foundational knowledge for digital literacy.</div>`,
			chNum, ch.title, ch.content, ch.title, ch.title)

		files[fmt.Sprintf("ch%02d/index.html", chNum)] = bs(htmlPage("en", fmt.Sprintf("Chapter %d: %s", chNum, ch.title), body))
	}

	manifest := scorm12Manifest("TEST_MULTI_SCO_8CH", "org_multi", "Digital Literacy: Complete 8-Chapter Course", items, resources)
	files["imsmanifest.xml"] = bs(manifest)
	return buildZIP(files)
}

func genSubdirectoryLayout() ([]byte, error) {
	manifest := scorm12Manifest("TEST_SUBDIR", "org_subdir", "Subdirectory Layout Test",
		[]string{scorm12Item("item1", "res1", "Module 1: Testing Subdirectory Paths")},
		[]string{scorm12Resource("res1", "Course_Content/index.html", []string{"Course_Content/index.html"})},
	)
	body := `<h1>Module 1: Subdirectory Path Testing</h1>
<p>This SCORM package tests whether the scraper correctly resolves resources located inside a named parent directory.</p>`
	return buildZIP(map[string][]byte{
		"imsmanifest.xml":           bs(manifest),
		"Course_Content/index.html": bs(htmlPage("en", "Subdirectory Path Test", body)),
	})
}

func genWithPDF() ([]byte, error) {
	manifest := `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="TEST_PDF_RESOURCE" version="1.2"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="org_pdf">
    <organization identifier="org_pdf">
      <title>SCORM with PDF Resource</title>
      <item identifier="item1" identifierref="res1"><title>Chapter 1: PDF Content Test</title></item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="res1" type="webcontent" adlcp:scormtype="sco" href="index.html">
      <file href="index.html"/>
      <file href="resources/chapter1.pdf"/>
    </resource>
  </resources>
</manifest>`

	minimalPDF := `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj
xref
0 4
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
trailer<</Size 4/Root 1 0 R>>
startxref
212
%%EOF`

	body := `<h1>Chapter 1: PDF Resource Test</h1>
<p>This SCORM package contains a PDF file as a resource. The scraper should detect and extract the PDF content.</p>`

	return buildZIP(map[string][]byte{
		"imsmanifest.xml":        bs(manifest),
		"index.html":             bs(htmlPage("en", "PDF Resource Test", body)),
		"resources/chapter1.pdf": bs(minimalPDF),
	})
}

func genExternalLinks() ([]byte, error) {
	manifest := scorm12Manifest("TEST_EXT_LINKS", "org_ext", "External Links Test",
		[]string{scorm12Item("item1", "res1", "Module: External Resources")},
		[]string{scorm12Resource("res1", "index.html", []string{"index.html"})},
	)
	body := `<h1>Module: External Resources and Links</h1>
<p>This SCORM package contains multiple external hyperlinks.</p>
<ul>
  <li><a href="https://www.w3.org/TR/scorm/" target="_blank">W3C SCORM Specification</a></li>
  <li><a href="https://adlnet.gov/projects/scorm/" target="_blank">ADL SCORM Documentation</a></li>
  <li><a href="https://moodle.org/mod/forum/discuss.php?d=12345" target="_blank">Moodle Community Forum</a></li>
  <li><a href="https://github.com/scorm/scorm-again" target="_blank">SCORM Again Library (GitHub)</a></li>
  <li><a href="https://cloudfront.net/assets/sample-video.mp4" target="_blank">Supplemental Video Resource</a></li>
</ul>`
	return buildZIP(map[string][]byte{
		"imsmanifest.xml": bs(manifest),
		"index.html":      bs(htmlPage("en", "External Links Test", body)),
	})
}

func genMultilingualFR() ([]byte, error) {
	manifest := scorm12Manifest("TEST_FR_LANG", "org_fr", "Cours de Compétences Numériques",
		[]string{scorm12Item("item1", "res1", "Chapitre 1 : Introduction à la Littératie Numérique")},
		[]string{scorm12Resource("res1", "index.html", []string{"index.html"})},
	)
	body := `<h1>Chapitre 1 : Introduction à la Littératie Numérique</h1>
<p>La littératie numérique désigne la capacité d'utiliser efficacement les technologies de l'information et de la communication pour communiquer, apprendre, travailler et résoudre des problèmes dans le monde numérique d'aujourd'hui.</p>`
	return buildZIP(map[string][]byte{
		"imsmanifest.xml": bs(manifest),
		"index.html":      bs(htmlPage("fr", "Chapitre 1 : Littératie Numérique", body)),
	})
}

func genLanguageCourse(code, manifestID, title, chapterTitle, paragraph, objective, summary string) ([]byte, error) {
	manifest := scorm12Manifest(manifestID, "org_"+strings.ToLower(strings.ReplaceAll(code, "-", "_")), title,
		[]string{scorm12Item("item1", "res1", chapterTitle)},
		[]string{scorm12Resource("res1", "index.html", []string{"index.html"})},
	)
	body := fmt.Sprintf(`<h1>%s</h1>
<p>%s</p>
<h2>Learning objectives</h2>
<ul>
  <li>%s</li>
</ul>
<div class="summary"><strong>Summary:</strong> %s</div>`, chapterTitle, paragraph, objective, summary)
	return buildZIP(map[string][]byte{
		"imsmanifest.xml": bs(manifest),
		"index.html":      bs(htmlPage(code, chapterTitle, body)),
	})
}

func genMultilingualES() ([]byte, error) {
	return genLanguageCourse("es", "TEST_ES_LANG", "Habilidades basicas de computacion",
		"Capitulo 1: Introduccion a la alfabetizacion digital",
		"La alfabetizacion digital permite usar computadoras, dispositivos moviles e internet para aprender, comunicarse y resolver problemas.",
		"Comprender que significa la alfabetizacion digital",
		"Las habilidades digitales ayudan a trabajar con informacion, colaborar en linea y proteger datos personales.")
}

func genMultilingualJA() ([]byte, error) {
	return genLanguageCourse("ja", "TEST_JA_LANG", "Computer Basic Skills",
		"Chapter 1: Japanese Digital Literacy Test",
		"デジタルリテラシーとは、コンピューター、スマートフォン、インターネットを安全かつ効果的に使い、学習、仕事、コミュニケーションに役立てる能力です。",
		"デジタルリテラシーの意味を理解する",
		"デジタルスキルは情報を扱い、オンラインで協力し、個人情報を守るために重要です。")
}

func genMultilingualDE() ([]byte, error) {
	return genLanguageCourse("de", "TEST_DE_LANG", "Grundlegende Computerkenntnisse",
		"Kapitel 1: Einfuhrung in digitale Kompetenz",
		"Digitale Kompetenz bedeutet, Computer, mobile Gerate und das Internet sicher und zielgerichtet zu nutzen, um zu lernen, zu arbeiten und Probleme zu losen.",
		"Den Begriff digitale Kompetenz verstehen",
		"Digitale Fahigkeiten verbessern Produktivitat, Kommunikation und verantwortungsvolles Arbeiten mit Daten.")
}

func genMultilingualNL() ([]byte, error) {
	return genLanguageCourse("nl", "TEST_NL_LANG", "Basisvaardigheden computergebruik",
		"Hoofdstuk 1: Inleiding tot digitale geletterdheid",
		"Digitale geletterdheid is het vermogen om computers, mobiele apparaten en internet veilig en effectief te gebruiken voor leren, werken en communiceren.",
		"Begrijpen wat digitale geletterdheid betekent",
		"Digitale vaardigheden helpen gebruikers informatie te vinden, samen te werken en persoonlijke gegevens te beschermen.")
}

func genMultilingualPT() ([]byte, error) {
	return genLanguageCourse("pt", "TEST_PT_LANG", "Competencias basicas de computador",
		"Capitulo 1: Introducao a literacia digital",
		"A literacia digital permite utilizar computadores, dispositivos moveis e a internet com seguranca para comunicar, aprender, trabalhar e resolver problemas.",
		"Compreender o conceito de literacia digital",
		"As competencias digitais apoiam a produtividade, a colaboracao online e a protecao de dados pessoais.")
}

func genMultilingualIT() ([]byte, error) {
	return genLanguageCourse("it", "TEST_IT_LANG", "Competenze informatiche di base",
		"Capitolo 1: Introduzione alla competenza digitale",
		"La competenza digitale permette di usare computer, dispositivi mobili e internet in modo sicuro ed efficace per comunicare, imparare e lavorare.",
		"Comprendere il significato di competenza digitale",
		"Le competenze digitali aiutano a gestire informazioni, collaborare online e proteggere i dati personali.")
}

func genMultilingualAR() ([]byte, error) {
	manifest := scorm12Manifest("TEST_AR_LANG", "org_ar", "مهارات الحاسوب الأساسية",
		[]string{scorm12Item("item1", "res1", "الفصل الأول: مقدمة في محو الأمية الرقمية")},
		[]string{scorm12Resource("res1", "index.html", []string{"index.html"})},
	)
	body := `<div dir="rtl" lang="ar">
<h1>الفصل الأول: مقدمة في محو الأمية الرقمية</h1>
<p>تشير محو الأمية الرقمية إلى القدرة على استخدام أجهزة الكمبيوتر والأجهزة الرقمية والإنترنت بشكل فعّال للتواصل والتعلم والعمل وحل المشكلات.</p>
</div>`
	return buildZIP(map[string][]byte{
		"imsmanifest.xml": bs(manifest),
		"index.html":      bs(htmlPage("ar", "الفصل الأول: محو الأمية الرقمية", body)),
	})
}

func genMultilingualUR() ([]byte, error) {
	manifest := scorm12Manifest("TEST_UR_LANG", "org_ur", "کمپیوٹر کی بنیادی مہارتیں",
		[]string{scorm12Item("item1", "res1", "باب اول: ڈیجیٹل خواندگی کا تعارف")},
		[]string{scorm12Resource("res1", "index.html", []string{"index.html"})},
	)
	body := `<div dir="rtl" lang="ur">
<h1>باب اول: ڈیجیٹل خواندگی کا تعارف</h1>
<p>ڈیجیٹل خواندگی سے مراد کمپیوٹر، ڈیجیٹل آلات اور انٹرنیٹ کو مؤثر طریقے سے استعمال کرنے کی صلاحیت ہے۔</p>
</div>`
	return buildZIP(map[string][]byte{
		"imsmanifest.xml": bs(manifest),
		"index.html":      bs(htmlPage("ur", "باب اول: ڈیجیٹل خواندگی", body)),
	})
}

func genDeeplyNested() ([]byte, error) {
	manifest := scorm12Manifest("TEST_DEEP_NEST", "org_deep", "Deeply Nested Path Test",
		[]string{scorm12Item("item1", "res1", "Module: Deep Path")},
		[]string{scorm12Resource("res1", "content/level1/level2/level3/level4/level5/index.html",
			[]string{"content/level1/level2/level3/level4/level5/index.html"})},
	)
	body := `<h1>Deeply Nested Resource</h1>
<p>This file is located 5 folder levels deep: <code>content/level1/level2/level3/level4/level5/index.html</code></p>`
	return buildZIP(map[string][]byte{
		"imsmanifest.xml": bs(manifest),
		"content/level1/level2/level3/level4/level5/index.html": bs(htmlPage("en", "Deep Nest Test", body)),
	})
}

func genHugeHTML() ([]byte, error) {
	manifest := scorm12Manifest("TEST_HUGE_HTML", "org_huge", "Large Content Stress Test",
		[]string{scorm12Item("item1", "res1", "Chapter: Extensive Content")},
		[]string{scorm12Resource("res1", "index.html", []string{"index.html"})},
	)

	var sb strings.Builder
	sb.WriteString("<h1>Stress Test: Large HTML Content</h1>\n")
	topics := []string{"Cloud Computing", "Machine Learning", "DevOps", "Cybersecurity", "Data Science", "API Design", "Microservices", "Containerization", "Serverless Architecture", "Edge Computing"}
	for i := 0; sb.Len() < 2*1024*1024; i++ {
		topic := topics[i%len(topics)]
		sb.WriteString(fmt.Sprintf(`<h2>Section %d: %s</h2>
<p>%s is a transformative technology paradigm. Understanding %s requires both theoretical knowledge and practical experience.</p>
<ul>
  <li>Core principles of %s architecture</li>
  <li>Best practices for %s in enterprise environments</li>
</ul>`, i+1, topic, topic, topic, topic, topic))
	}

	return buildZIP(map[string][]byte{
		"imsmanifest.xml": bs(manifest),
		"index.html":      bs(htmlPage("en", "Large Content Stress Test", sb.String())),
	})
}

func genNoResourcesTag() ([]byte, error) {
	manifest := `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="TEST_NO_RESOURCES" version="1.2"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="org1">
    <organization identifier="org1">
      <title>Course Without Resources Tag</title>
      <item identifier="item1" identifierref="res1"><title>Chapter 1</title></item>
    </organization>
  </organizations>
</manifest>`
	return buildZIP(map[string][]byte{
		"imsmanifest.xml": bs(manifest),
		"index.html":      bs(htmlPage("en", "No Resources Tag", "<h1>No Resources</h1><p>This manifest has no resources section.</p>")),
	})
}

func genEmptyHTMLFiles() ([]byte, error) {
	manifest := scorm12Manifest("TEST_EMPTY_HTML", "org_empty", "Empty HTML Files Test",
		[]string{scorm12Item("item1", "res1", "Chapter 1")},
		[]string{scorm12Resource("res1", "index.html", []string{"index.html"})},
	)
	return buildZIP(map[string][]byte{
		"imsmanifest.xml": bs(manifest),
		"index.html":      {},
	})
}

func genWithComments() ([]byte, error) {
	manifest := `<?xml version="1.0" encoding="UTF-8"?>
<!-- SCORM Package: Comment Stress Test -->
<manifest identifier="TEST_COMMENTS" version="1.2"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
  <!-- Metadata section -->
  <metadata>
    <schema>ADL SCORM</schema>
    <!-- Version must be exactly "1.2" -->
    <schemaversion>1.2</schemaversion>
  </metadata>
  <!-- Organizations -->
  <organizations default="org_comments">
    <organization identifier="org_comments">
      <title>Comment-Heavy SCORM Package</title>
      <item identifier="item1" identifierref="res1">
        <title>Chapter 1: Comment Test</title>
      </item>
    </organization>
  </organizations>
  <!-- Resources -->
  <resources>
    <resource identifier="res1" type="webcontent" adlcp:scormtype="sco" href="index.html">
      <file href="index.html"/>
    </resource>
  </resources>
</manifest>`
	body := `<h1>XML Comment Stress Test</h1>
<p>This manifest contains extensive XML comments between every element.</p>`
	return buildZIP(map[string][]byte{
		"imsmanifest.xml": bs(manifest),
		"index.html":      bs(htmlPage("en", "Comment Test", body)),
	})
}

func genWindowsPaths() ([]byte, error) {
	manifest := `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="TEST_WIN_PATHS" version="1.2"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="org_win">
    <organization identifier="org_win">
      <title>Windows Path Test</title>
      <item identifier="item1" identifierref="res1"><title>Chapter 1</title></item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="res1" type="webcontent" adlcp:scormtype="sco" href="resources\index.html">
      <file href="resources\index.html"/>
    </resource>
  </resources>
</manifest>`
	body := `<h1>Windows Path Normalization Test</h1>
<p>This manifest uses Windows-style backslash paths: <code>resources\index.html</code>.</p>`
	return buildZIP(map[string][]byte{
		"imsmanifest.xml":      bs(manifest),
		"resources/index.html": bs(htmlPage("en", "Windows Path Test", body)),
	})
}

func genEmptyZIP() ([]byte, error) {
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	w.Close()
	return buf.Bytes(), nil
}

func genNoManifest() ([]byte, error) {
	return buildZIP(map[string][]byte{
		"index.html": bs(htmlPage("en", "No Manifest", "<h1>No Manifest</h1><p>This ZIP has no imsmanifest.xml.</p>")),
		"README.txt": bs("This ZIP has no imsmanifest.xml file."),
	})
}

func genCorruptZIP() ([]byte, error) {
	garbage := []byte{0xDE, 0xAD, 0xBE, 0xEF, 0xCA, 0xFE, 0xBA, 0xBE,
		0x00, 0x01, 0x02, 0x03, 0xFF, 0xFE, 0xFD, 0xFC}
	return bytes.Repeat(garbage, 100), nil
}

func genMalformedXML() ([]byte, error) {
	badManifest := `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="BROKEN" version="1.2"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2">
  <metadata>
    <schema>ADL SCORM</schema>
  <!-- UNCLOSED COMMENT
  <organizations default="org1">
    <title>Broken Course</title
    <<DOUBLE_BRACKET>>
  &invalid_entity;`
	return buildZIP(map[string][]byte{
		"imsmanifest.xml": bs(badManifest),
		"index.html":      bs(htmlPage("en", "Malformed XML Test", "<h1>Test</h1>")),
	})
}

func genBinaryAsHTML() ([]byte, error) {
	manifest := scorm12Manifest("TEST_BINARY_HTML", "org_bin", "Binary Content as HTML",
		[]string{scorm12Item("item1", "res1", "Binary Content Test")},
		[]string{scorm12Resource("res1", "index.html", []string{"index.html"})},
	)
	binaryContent := make([]byte, 4096)
	for i := range binaryContent {
		binaryContent[i] = byte(i % 256)
	}
	return buildZIP(map[string][]byte{
		"imsmanifest.xml": bs(manifest),
		"index.html":      binaryContent,
	})
}

func genRenamedPDF() ([]byte, error) {
	pdf := `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj
xref
0 4
0000000000 65535 f
0000000009 00000 n
trailer<</Size 4/Root 1 0 R>>
startxref
150
%%EOF`
	return []byte(pdf), nil
}

func genZeroByte() ([]byte, error) { return []byte{}, nil }

func genNestedZIP() ([]byte, error) {
	inner2, _ := buildZIP(map[string][]byte{"readme.txt": bs("innermost content")})
	middle, _ := buildZIP(map[string][]byte{"inner.zip": inner2, "readme.txt": bs("middle content")})
	return buildZIP(map[string][]byte{"middle.zip": middle, "readme.txt": bs("outer content")})
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

func generateSCORM(genType string) ([]byte, error) {
	switch genType {
	case "minimal-scorm12":
		return genMinimalSCORM12()
	case "minimal-scorm2004":
		return genMinimalSCORM2004()
	case "multi-sco-8ch":
		return genMultiSCO8Ch()
	case "subdirectory-layout":
		return genSubdirectoryLayout()
	case "with-pdf-resource":
		return genWithPDF()
	case "external-links":
		return genExternalLinks()
	case "multilingual-fr":
		return genMultilingualFR()
	case "multilingual-es":
		return genMultilingualES()
	case "multilingual-ja":
		return genMultilingualJA()
	case "multilingual-de":
		return genMultilingualDE()
	case "multilingual-nl":
		return genMultilingualNL()
	case "multilingual-pt":
		return genMultilingualPT()
	case "multilingual-it":
		return genMultilingualIT()
	case "multilingual-ar":
		return genMultilingualAR()
	case "multilingual-ur":
		return genMultilingualUR()
	case "deeply-nested":
		return genDeeplyNested()
	case "huge-html-2mb":
		return genHugeHTML()
	case "no-resources-tag":
		return genNoResourcesTag()
	case "empty-html-files":
		return genEmptyHTMLFiles()
	case "scorm-with-comments":
		return genWithComments()
	case "windows-paths":
		return genWindowsPaths()
	case "empty-zip":
		return genEmptyZIP()
	case "no-manifest":
		return genNoManifest()
	case "corrupt-zip":
		return genCorruptZIP()
	case "malformed-xml":
		return genMalformedXML()
	case "binary-as-html":
		return genBinaryAsHTML()
	case "renamed-pdf-as-zip":
		return genRenamedPDF()
	case "zero-byte-file":
		return genZeroByte()
	case "nested-zip-bomb":
		return genNestedZIP()
	case "no-field-name":
		return genMinimalSCORM12()
	default:
		return nil, fmt.Errorf("unknown generator type: %s", genType)
	}
}

// ── Handler: GET /api/scorm/generate/{type} ──────────────────────────────────

func handleScormGenerate(w http.ResponseWriter, r *http.Request) {
	genType := strings.TrimPrefix(r.URL.Path, "/api/scorm/generate/")

	if genType == "list" || genType == "" {
		scormJSON(w, 200, scormRegistry)
		return
	}

	var meta *GenMeta
	for _, m := range scormRegistry {
		if m.Type == genType {
			mc := m
			meta = &mc
			break
		}
	}
	if meta == nil {
		scormErr(w, 404, "unknown generator: "+genType)
		return
	}

	data, err := generateSCORM(genType)
	if err != nil {
		scormErr(w, 500, "generate failed: "+err.Error())
		return
	}

	log.Printf("[SCORM GEN] type=%s filename=%s size=%d bytes", genType, meta.Filename, len(data))

	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, meta.Filename))
	w.Header().Set("Content-Length", fmt.Sprintf("%d", len(data)))
	w.Header().Set("X-Generator-Type", genType)
	w.Header().Set("X-Test-Category", meta.Category)
	w.Write(data)
}
