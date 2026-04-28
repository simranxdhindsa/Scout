// server.go
// Ardoise Test Dashboard — Go backend (stdlib only, no external deps).
//
// Run from e2e/dashboard/backend/:
//   go run .              ← dev (compiles on the fly)
//   go build -o server .  ← compile once, then ./server
//
// Open: http://localhost:4000

package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

const port = 4000

// Paths resolved from CWD (must run from e2e/dashboard/backend/).
var (
	runsDir  string // ../../reports/runs
	distDir  string // ../frontend/dist
	repoRoot string // ../../..  (repo root)
	authDir  string // ../../../e2e/.auth
)

// ── Active run tracking ────────────────────────────────────────────────────

type activeRun struct {
	Product   string    `json:"product"`
	Status    string    `json:"status"` // "running" | "done" | "failed"
	ExitCode  int       `json:"exitCode"`
	StartedAt time.Time `json:"startedAt"`

	lines []string
	mu    sync.Mutex
}

var (
	currentRun   *activeRun
	currentRunMu sync.Mutex
)

// ── Entry point ────────────────────────────────────────────────────────────

func main() {
	cwd, err := os.Getwd()
	if err != nil {
		log.Fatal("cannot determine working directory:", err)
	}
	runsDir  = filepath.Join(cwd, "..", "..", "reports", "runs")
	distDir  = filepath.Join(cwd, "..", "frontend", "dist")
	repoRoot = filepath.Clean(filepath.Join(cwd, "..", "..", ".."))
	authDir  = filepath.Join(repoRoot, "e2e", ".auth")

	mux := http.NewServeMux()

	// ── Existing report API ───────────────────────────────────────────────
	mux.HandleFunc("GET /api/runs", handleRuns)
	mux.HandleFunc("GET /api/runs/{ts}/results", handleResults)
	mux.HandleFunc("GET /api/screenshot", handleScreenshot)
	mux.HandleFunc("GET /api/attachment", handleAttachment)

	// ── Control panel API ─────────────────────────────────────────────────
	mux.HandleFunc("POST /api/run", handleStartRun)
	mux.HandleFunc("GET /api/run/output", handleRunOutput)
	mux.HandleFunc("POST /api/codegen", handleCodegen)
	mux.HandleFunc("GET /api/auth/status", handleAuthStatus)
	mux.HandleFunc("DELETE /api/auth/{product}", handleAuthClear)

	// ── Static: Playwright HTML reports ──────────────────────────────────
	mux.Handle("/reports/", http.StripPrefix("/reports/", http.FileServer(http.Dir(runsDir))))

	// ── Static: React SPA ─────────────────────────────────────────────────
	if _, err := os.Stat(distDir); err == nil {
		mux.Handle("/", newSPAHandler(distDir))
	} else {
		mux.HandleFunc("/", notBuiltHandler)
	}

	fmt.Printf("\n🎭 Ardoise Test Dashboard (Go)\n")
	fmt.Printf("   http://localhost:%d\n\n", port)
	fmt.Printf("   API:      /api/runs\n")
	fmt.Printf("   Control:  /api/run  /api/codegen  /api/auth/status\n")
	fmt.Printf("   Reports:  /reports/{timestamp}/html/index.html\n")
	if _, err := os.Stat(distDir); err != nil {
		fmt.Printf("\n⚠️  React app not built. Run:\n")
		fmt.Printf("   cd ../frontend && npm install && npm run build\n\n")
	}

	addr := fmt.Sprintf(":%d", port)
	log.Printf("Listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}

// ── Types ──────────────────────────────────────────────────────────────────

type runMeta struct {
	Timestamp    string        `json:"timestamp"`
	Label        string        `json:"label"`
	Passed       int           `json:"passed"`
	Failed       int           `json:"failed"`
	Skipped      int           `json:"skipped"`
	Total        int           `json:"total"`
	DurationMs   int           `json:"durationMs"`
	Products     []string      `json:"products"`
	ErrorSummary *errorSummary `json:"errorSummary,omitempty"`
}

type errorSummary struct {
	ConsoleErrors  int      `json:"consoleErrors"`
	APIErrors      int      `json:"apiErrors"`
	FailedRequests int      `json:"failedRequests"`
	PageErrors     int      `json:"pageErrors"`
	TopErrors      []string `json:"topErrors"`
}

// ── GET /api/runs ──────────────────────────────────────────────────────────

func handleRuns(w http.ResponseWriter, r *http.Request) {
	entries, err := os.ReadDir(runsDir)
	if os.IsNotExist(err) {
		writeJSON(w, []runMeta{})
		return
	}
	if err != nil {
		http.Error(w, "failed to read runs directory", http.StatusInternalServerError)
		return
	}

	var runs []runMeta
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		metaPath := filepath.Join(runsDir, e.Name(), "meta.json")
		data, err := os.ReadFile(metaPath)
		if err != nil {
			runs = append(runs, runMeta{
				Timestamp: e.Name(),
				Label:     e.Name(),
				Products:  []string{},
			})
			continue
		}
		var m runMeta
		if err := json.Unmarshal(data, &m); err != nil {
			runs = append(runs, runMeta{Timestamp: e.Name(), Label: e.Name(), Products: []string{}})
			continue
		}
		if m.Products == nil {
			m.Products = []string{}
		}
		runs = append(runs, m)
	}

	sort.Slice(runs, func(i, j int) bool {
		return runs[i].Timestamp > runs[j].Timestamp
	})

	writeJSON(w, runs)
}

// ── GET /api/runs/{ts}/results ────────────────────────────────────────────

var safeTS = regexp.MustCompile(`^[A-Za-z0-9\-_]+$`)

func handleResults(w http.ResponseWriter, r *http.Request) {
	ts := r.PathValue("ts")
	if ts == "" || !safeTS.MatchString(ts) {
		http.Error(w, "invalid timestamp", http.StatusBadRequest)
		return
	}

	file := filepath.Join(runsDir, ts, "results.json")
	data, err := os.ReadFile(file)
	if os.IsNotExist(err) {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		http.Error(w, "failed to read results", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(data)
}

// ── GET /api/screenshot  &  GET /api/attachment ───────────────────────────

var imageExts = map[string]bool{
	".png": true, ".jpg": true, ".jpeg": true, ".webp": true,
}

var attachmentExts = map[string]bool{
	".json": true, ".png": true, ".jpg": true, ".jpeg": true, ".webp": true, ".zip": true,
}

func handleScreenshot(w http.ResponseWriter, r *http.Request) {
	servePathFile(w, r, imageExts)
}

func handleAttachment(w http.ResponseWriter, r *http.Request) {
	servePathFile(w, r, attachmentExts)
}

func servePathFile(w http.ResponseWriter, r *http.Request, allowed map[string]bool) {
	filePath := r.URL.Query().Get("path")
	if filePath == "" {
		http.Error(w, "missing path parameter", http.StatusBadRequest)
		return
	}
	clean := filepath.Clean(filePath)
	if strings.Contains(clean, "..") {
		http.Error(w, "path not allowed", http.StatusBadRequest)
		return
	}
	ext := strings.ToLower(filepath.Ext(clean))
	if !allowed[ext] {
		http.Error(w, "file type not allowed", http.StatusBadRequest)
		return
	}
	if _, err := os.Stat(clean); os.IsNotExist(err) {
		http.NotFound(w, r)
		return
	}
	http.ServeFile(w, r, clean)
}

// ── POST /api/run ──────────────────────────────────────────────────────────
// Body: {"product":"all"|"ui"|"mc"|"sw"}
// Returns immediately; poll /api/run/output?offset=N for live lines.

func handleStartRun(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Product string `json:"product"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Product == "" {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	validProducts := map[string]bool{"all": true, "ui": true, "mc": true, "sw": true}
	if !validProducts[body.Product] {
		http.Error(w, "invalid product — must be all|ui|mc|sw", http.StatusBadRequest)
		return
	}

	currentRunMu.Lock()
	if currentRun != nil && currentRun.Status == "running" {
		currentRunMu.Unlock()
		http.Error(w, "a run is already in progress", http.StatusConflict)
		return
	}

	run := &activeRun{
		Product:   body.Product,
		Status:    "running",
		StartedAt: time.Now(),
	}
	currentRun = run
	currentRunMu.Unlock()

	scriptName := "pw:test"
	if body.Product != "all" {
		scriptName = "pw:test:" + body.Product
	}

	go func() {
		cmd := exec.Command("cmd", "/c", "npm", "run", scriptName)
		cmd.Dir = repoRoot

		stdout, _ := cmd.StdoutPipe()
		stderr, _ := cmd.StderrPipe()

		if err := cmd.Start(); err != nil {
			run.mu.Lock()
			run.lines = append(run.lines, "ERROR: failed to start process: "+err.Error())
			run.Status = "failed"
			run.mu.Unlock()
			return
		}

		// Read stdout and stderr concurrently to avoid pipe deadlock
		var wg sync.WaitGroup
		collect := func(rd io.Reader) {
			defer wg.Done()
			scanner := bufio.NewScanner(rd)
			scanner.Buffer(make([]byte, 64*1024), 64*1024) // larger buffer for long lines
			for scanner.Scan() {
				line := scanner.Text()
				run.mu.Lock()
				run.lines = append(run.lines, line)
				run.mu.Unlock()
			}
		}
		wg.Add(2)
		go collect(stdout)
		go collect(stderr)
		wg.Wait()

		err := cmd.Wait()
		run.mu.Lock()
		if err != nil {
			run.Status = "failed"
			if exitErr, ok := err.(*exec.ExitError); ok {
				run.ExitCode = exitErr.ExitCode()
			} else {
				run.ExitCode = 1
			}
		} else {
			run.Status = "done"
			run.ExitCode = 0
		}
		run.mu.Unlock()
	}()

	writeJSON(w, map[string]any{
		"status":  "started",
		"product": body.Product,
	})
}

// ── GET /api/run/output?offset=N ──────────────────────────────────────────
// Returns lines[N:] plus current run status. Frontend polls this.

func handleRunOutput(w http.ResponseWriter, r *http.Request) {
	currentRunMu.Lock()
	run := currentRun
	currentRunMu.Unlock()

	if run == nil {
		writeJSON(w, map[string]any{
			"status":     "idle",
			"product":    "",
			"lines":      []string{},
			"totalLines": 0,
			"exitCode":   0,
		})
		return
	}

	// Parse offset
	offset := 0
	if s := r.URL.Query().Get("offset"); s != "" {
		fmt.Sscanf(s, "%d", &offset)
	}

	run.mu.Lock()
	status   := run.Status
	exitCode := run.ExitCode
	product  := run.Product
	total    := len(run.lines)
	var newLines []string
	if offset < total {
		newLines = make([]string, total-offset)
		copy(newLines, run.lines[offset:])
	}
	run.mu.Unlock()

	if newLines == nil {
		newLines = []string{}
	}

	writeJSON(w, map[string]any{
		"status":     status,
		"product":    product,
		"lines":      newLines,
		"totalLines": total,
		"exitCode":   exitCode,
	})
}

// ── POST /api/codegen ──────────────────────────────────────────────────────
// Body: {"product":"ui"|"mc"|"sw"}
// Opens a headed browser for recording. Returns immediately.

func handleCodegen(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Product string `json:"product"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Product == "" {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	validProducts := map[string]bool{"ui": true, "mc": true, "sw": true}
	if !validProducts[body.Product] {
		http.Error(w, "invalid product — must be ui|mc|sw", http.StatusBadRequest)
		return
	}

	scriptName := "pw:codegen:" + body.Product
	cmd := exec.Command("cmd", "/c", "npm", "run", scriptName)
	cmd.Dir = repoRoot

	if err := cmd.Start(); err != nil {
		http.Error(w, "failed to launch browser: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Interactive process — don't wait, let it run
	go func() { _ = cmd.Wait() }()

	writeJSON(w, map[string]string{"status": "launched", "product": body.Product})
}

// ── GET /api/auth/status ───────────────────────────────────────────────────

type authInfo struct {
	Product  string `json:"product"`
	HasCache bool   `json:"hasCache"`
	Age      string `json:"age,omitempty"`
	Expired  bool   `json:"expired"`
}

func handleAuthStatus(w http.ResponseWriter, r *http.Request) {
	products := []string{"mc", "ui", "sw"}
	var result []authInfo

	for _, p := range products {
		path := filepath.Join(authDir, p+"-user.json")
		info, err := os.Stat(path)
		if err != nil {
			result = append(result, authInfo{Product: p, HasCache: false, Expired: true})
			continue
		}
		age := time.Since(info.ModTime())
		result = append(result, authInfo{
			Product:  p,
			HasCache: true,
			Age:      formatAge(age),
			Expired:  age > 23*time.Hour,
		})
	}

	writeJSON(w, result)
}

// ── DELETE /api/auth/{product} ─────────────────────────────────────────────

func handleAuthClear(w http.ResponseWriter, r *http.Request) {
	product := r.PathValue("product")
	valid := map[string]bool{"ui": true, "mc": true, "sw": true}
	if !valid[product] {
		http.Error(w, "invalid product", http.StatusBadRequest)
		return
	}

	path := filepath.Join(authDir, product+"-user.json")
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		http.Error(w, "failed to clear auth session", http.StatusInternalServerError)
		return
	}

	writeJSON(w, map[string]string{"status": "cleared", "product": product})
}

// ── SPA handler ────────────────────────────────────────────────────────────

type spaHandler struct {
	root string
	fs   http.Handler
}

func newSPAHandler(root string) http.Handler {
	return &spaHandler{root: root, fs: http.FileServer(http.Dir(root))}
}

func (h *spaHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	target := filepath.Join(h.root, filepath.Clean("/"+r.URL.Path))
	fi, err := os.Stat(target)
	if err == nil && !fi.IsDir() {
		h.fs.ServeHTTP(w, r)
		return
	}
	http.ServeFile(w, r, filepath.Join(h.root, "index.html"))
}

func notBuiltHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	fmt.Fprintf(w, `<!doctype html>
<html><body style="font-family:system-ui;padding:2rem;background:#f5f7fb;color:#1e2033;">
  <h2>🎭 Ardoise Test Dashboard</h2>
  <p style="color:#dc2626;margin:1rem 0">React app not built yet.</p>
  <p>Run: <code style="background:#e8eaf4;padding:4px 8px;border-radius:4px;">
    cd ../frontend &amp;&amp; npm install &amp;&amp; npm run build
  </code></p>
  <p>Then restart this server.</p>
</body></html>`)
}

// ── Helpers ────────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("writeJSON error: %v", err)
	}
}

func formatAge(d time.Duration) string {
	if d < time.Minute {
		return "just now"
	} else if d < time.Hour {
		return fmt.Sprintf("%dm ago", int(d.Minutes()))
	}
	return fmt.Sprintf("%dh ago", int(d.Hours()))
}
