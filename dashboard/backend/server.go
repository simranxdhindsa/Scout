package main

import (
	"bufio"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

const serverPort = ":4000"

// rootDir resolves to the project root (two levels up from dashboard/backend/).
var rootDir string

func init() {
	abs, err := filepath.Abs(filepath.Join("..", ".."))
	if err != nil {
		log.Fatal(err)
	}
	rootDir = abs
}

// ---------------------------------------------------------------------------
// Shared run state
// ---------------------------------------------------------------------------

type runState struct {
	mu       sync.Mutex
	running  bool
	status   string // "idle" | "running" | "done" | "failed" | "stopped"
	lines    []string
	exitCode int
	pgid     int
	product  string
}

var rs = &runState{status: "idle"}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// safeChild returns true when target is inside base, rejecting traversal.
func safeChild(base, target string) bool {
	rel, err := filepath.Rel(base, target)
	if err != nil {
		return false
	}
	return !strings.HasPrefix(rel, "..")
}

// ---------------------------------------------------------------------------
// POST /api/run   DELETE /api/run
// ---------------------------------------------------------------------------

func handleRun(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
		handleRunPost(w, r)
	case http.MethodDelete:
		handleRunDelete(w, r)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func handleRunPost(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Product string `json:"product"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Product == "" {
		http.Error(w, "body must contain {\"product\":\"all|<name>\"}", http.StatusBadRequest)
		return
	}

	rs.mu.Lock()
	if rs.running {
		rs.mu.Unlock()
		writeJSON(w, http.StatusConflict, map[string]string{"error": "run already in progress"})
		return
	}
	rs.running = true
	rs.status = "running"
	rs.lines = nil
	rs.exitCode = 0
	rs.pgid = 0
	rs.product = body.Product
	rs.mu.Unlock()

	script := "pw:test"
	if body.Product != "all" {
		script = "pw:test:" + body.Product
	}

	cmd := exec.Command("npm", "run", script)
	cmd.Dir = rootDir
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		markFailed()
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		markFailed()
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	if err := cmd.Start(); err != nil {
		markFailed()
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	pgid, _ := syscall.Getpgid(cmd.Process.Pid)
	rs.mu.Lock()
	rs.pgid = pgid
	rs.mu.Unlock()

	go func() {
		var wg sync.WaitGroup
		appendLine := func(line string) {
			rs.mu.Lock()
			rs.lines = append(rs.lines, line)
			rs.mu.Unlock()
		}
		readPipe := func(rc io.Reader) {
			defer wg.Done()
			sc := bufio.NewScanner(rc)
			sc.Buffer(make([]byte, 512*1024), 512*1024)
			for sc.Scan() {
				appendLine(sc.Text())
			}
		}
		wg.Add(2)
		go readPipe(stdout)
		go readPipe(stderr)
		wg.Wait()

		runErr := cmd.Wait()
		rs.mu.Lock()
		defer rs.mu.Unlock()
		rs.running = false
		if rs.status != "stopped" {
			if runErr != nil {
				rs.status = "failed"
			} else {
				rs.status = "done"
			}
		}
		if cmd.ProcessState != nil {
			rs.exitCode = cmd.ProcessState.ExitCode()
		}
	}()

	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "started",
		"product": body.Product,
	})
}

func markFailed() {
	rs.mu.Lock()
	rs.running = false
	rs.status = "failed"
	rs.mu.Unlock()
}

func handleRunDelete(w http.ResponseWriter, r *http.Request) {
	rs.mu.Lock()
	defer rs.mu.Unlock()

	if !rs.running || rs.pgid == 0 {
		writeJSON(w, http.StatusOK, map[string]string{"status": "not running"})
		return
	}

	syscall.Kill(-rs.pgid, syscall.SIGKILL)
	rs.status = "stopped"
	rs.running = false

	writeJSON(w, http.StatusOK, map[string]string{"status": "stopped"})
}

// ---------------------------------------------------------------------------
// GET /api/run/output?offset=N
// ---------------------------------------------------------------------------

func handleRunOutput(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	offset := 0
	if s := r.URL.Query().Get("offset"); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n >= 0 {
			offset = n
		}
	}

	rs.mu.Lock()
	status := rs.status
	exitCode := rs.exitCode
	total := len(rs.lines)
	var lines []string
	if offset < total {
		lines = append([]string{}, rs.lines[offset:]...)
	} else {
		lines = []string{}
	}
	rs.mu.Unlock()

	writeJSON(w, http.StatusOK, map[string]any{
		"status":     status,
		"lines":      lines,
		"totalLines": total,
		"exitCode":   exitCode,
	})
}

// ---------------------------------------------------------------------------
// POST /api/codegen
// ---------------------------------------------------------------------------

func handleCodegen(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var body struct {
		Product string `json:"product"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Product == "" {
		http.Error(w, "body must contain {\"product\":\"<name>\"}", http.StatusBadRequest)
		return
	}

	envKey := strings.ToUpper(strings.ReplaceAll(body.Product, "-", "_")) + "_URL"
	baseURL := os.Getenv(envKey)
	if baseURL == "" {
		baseURL = "http://localhost:3000"
	}

	cmd := exec.Command("npx", "playwright", "codegen", baseURL)
	cmd.Dir = rootDir
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

	if err := cmd.Start(); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "launched",
		"product": body.Product,
	})
}

// ---------------------------------------------------------------------------
// GET /api/runs
// ---------------------------------------------------------------------------

func handleRunsList(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	runsDir := filepath.Join(rootDir, "reports", "runs")
	entries, err := os.ReadDir(runsDir)
	if err != nil {
		if os.IsNotExist(err) {
			writeJSON(w, http.StatusOK, []any{})
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	type runEntry struct {
		meta    map[string]any
		modTime time.Time
	}

	var runs []runEntry
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		metaPath := filepath.Join(runsDir, entry.Name(), "meta.json")
		data, err := os.ReadFile(metaPath)
		if err != nil {
			continue
		}
		var meta map[string]any
		if err := json.Unmarshal(data, &meta); err != nil {
			continue
		}
		info, _ := entry.Info()
		mod := time.Time{}
		if info != nil {
			mod = info.ModTime()
		}
		runs = append(runs, runEntry{meta: meta, modTime: mod})
	}

	sort.Slice(runs, func(i, j int) bool {
		return runs[i].modTime.After(runs[j].modTime)
	})

	result := make([]map[string]any, len(runs))
	for i, re := range runs {
		result[i] = re.meta
	}

	writeJSON(w, http.StatusOK, result)
}

// ---------------------------------------------------------------------------
// GET /api/runs/{timestamp}/results
// ---------------------------------------------------------------------------

func handleRunsItem(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	rest := strings.TrimPrefix(r.URL.Path, "/api/runs/")
	parts := strings.SplitN(rest, "/", 2)
	if len(parts) != 2 || parts[1] != "results" {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	ts := filepath.Clean(parts[0])
	if strings.Contains(ts, "..") || strings.ContainsAny(ts, "/\\") {
		http.Error(w, "invalid timestamp", http.StatusBadRequest)
		return
	}

	resultsPath := filepath.Join(rootDir, "reports", "runs", ts, "results.json")
	if !safeChild(rootDir, resultsPath) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	data, err := os.ReadFile(resultsPath)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

// ---------------------------------------------------------------------------
// GET /api/screenshot?path=...
// ---------------------------------------------------------------------------

func handleScreenshot(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	imgPath := r.URL.Query().Get("path")
	if imgPath == "" {
		http.Error(w, "path query param required", http.StatusBadRequest)
		return
	}

	absPath, err := filepath.Abs(imgPath)
	if err != nil || !safeChild(rootDir, absPath) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	http.ServeFile(w, r, absPath)
}

// ---------------------------------------------------------------------------
// POST /api/upload — accept a spec file, save it, and start a Playwright run
// ---------------------------------------------------------------------------

func handleUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if err := r.ParseMultipartForm(10 << 20); err != nil {
		http.Error(w, "failed to parse form", http.StatusBadRequest)
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		http.Error(w, "file field required", http.StatusBadRequest)
		return
	}
	defer file.Close()

	filename := filepath.Base(header.Filename)
	if !strings.HasSuffix(filename, ".spec.ts") && !strings.HasSuffix(filename, ".test.ts") {
		http.Error(w, "only .spec.ts and .test.ts files are accepted", http.StatusBadRequest)
		return
	}

	uploadDir := filepath.Join(rootDir, "specs", "uploaded")
	if err := os.MkdirAll(uploadDir, 0o755); err != nil {
		http.Error(w, "failed to create upload directory", http.StatusInternalServerError)
		return
	}

	// Minimal standalone config so uploaded specs run independently of the
	// main playwright.config.ts (which may have an empty projects array).
	uploadConfig := `import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: '../..' });
`
	if err := os.WriteFile(filepath.Join(uploadDir, "playwright.config.ts"), []byte(uploadConfig), 0o644); err != nil {
		http.Error(w, "failed to write playwright config", http.StatusInternalServerError)
		return
	}

	destPath := filepath.Join(uploadDir, filename)
	if !safeChild(rootDir, destPath) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	dest, err := os.Create(destPath)
	if err != nil {
		http.Error(w, "failed to save file", http.StatusInternalServerError)
		return
	}
	defer dest.Close()

	if _, err := io.Copy(dest, file); err != nil {
		http.Error(w, "failed to write file", http.StatusInternalServerError)
		return
	}

	rs.mu.Lock()
	if rs.running {
		rs.mu.Unlock()
		writeJSON(w, http.StatusConflict, map[string]string{"error": "run already in progress"})
		return
	}
	rs.running = true
	rs.status = "running"
	rs.lines = nil
	rs.exitCode = 0
	rs.pgid = 0
	rs.product = filename
	rs.mu.Unlock()

	relPath := filepath.Join("specs", "uploaded", filename)
	uploadConfigPath := filepath.Join(uploadDir, "playwright.config.ts")
	playwrightBin := filepath.Join(rootDir, "node_modules", ".bin", "playwright")
	cmd := exec.Command(playwrightBin, "test", relPath, "--config", uploadConfigPath)
	cmd.Dir = rootDir
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

	stdout, err := cmd.StdoutPipe()
	if err != nil {
		markFailed()
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		markFailed()
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	if err := cmd.Start(); err != nil {
		markFailed()
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	pgid, _ := syscall.Getpgid(cmd.Process.Pid)
	rs.mu.Lock()
	rs.pgid = pgid
	rs.mu.Unlock()

	go func() {
		var wg sync.WaitGroup
		appendLine := func(line string) {
			rs.mu.Lock()
			rs.lines = append(rs.lines, line)
			rs.mu.Unlock()
		}
		readPipe := func(rc io.Reader) {
			defer wg.Done()
			sc := bufio.NewScanner(rc)
			sc.Buffer(make([]byte, 512*1024), 512*1024)
			for sc.Scan() {
				appendLine(sc.Text())
			}
		}
		wg.Add(2)
		go readPipe(stdout)
		go readPipe(stderr)
		wg.Wait()

		runErr := cmd.Wait()
		rs.mu.Lock()
		defer rs.mu.Unlock()
		rs.running = false
		if rs.status != "stopped" {
			if runErr != nil {
				rs.status = "failed"
			} else {
				rs.status = "done"
			}
		}
		if cmd.ProcessState != nil {
			rs.exitCode = cmd.ProcessState.ExitCode()
		}
	}()

	writeJSON(w, http.StatusOK, map[string]string{
		"status":   "started",
		"filename": filename,
	})
}

// ---------------------------------------------------------------------------
// GET /api/auth/status   DELETE /api/auth/{product}
// ---------------------------------------------------------------------------

func handleAuth(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/api/auth/")

	if rest == "status" {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		handleAuthStatus(w, r)
		return
	}

	if r.Method == http.MethodDelete {
		handleAuthDelete(w, r, rest)
		return
	}

	http.Error(w, "not found", http.StatusNotFound)
}

func handleAuthStatus(w http.ResponseWriter, r *http.Request) {
	authDir := filepath.Join(rootDir, ".auth")
	entries, err := os.ReadDir(authDir)
	if err != nil {
		if os.IsNotExist(err) {
			writeJSON(w, http.StatusOK, []any{})
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	type authStatus struct {
		Product    string  `json:"product"`
		HasCache   bool    `json:"hasCache"`
		AgeSeconds float64 `json:"ageSeconds"`
		Expired    bool    `json:"expired"`
	}

	const expirySeconds = 82800 // 23 hours

	var statuses []authStatus
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), "-user.json") {
			continue
		}
		product := strings.TrimSuffix(entry.Name(), "-user.json")
		info, err := entry.Info()
		if err != nil {
			continue
		}
		age := time.Since(info.ModTime()).Seconds()
		statuses = append(statuses, authStatus{
			Product:    product,
			HasCache:   true,
			AgeSeconds: age,
			Expired:    age > expirySeconds,
		})
	}

	if statuses == nil {
		statuses = []authStatus{}
	}
	writeJSON(w, http.StatusOK, statuses)
}

func handleAuthDelete(w http.ResponseWriter, r *http.Request, product string) {
	if product == "" || strings.ContainsAny(product, "/\\..") {
		http.Error(w, "invalid product name", http.StatusBadRequest)
		return
	}

	authFile := filepath.Join(rootDir, ".auth", product+"-user.json")
	if !safeChild(rootDir, authFile) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	if err := os.Remove(authFile); err != nil {
		if os.IsNotExist(err) {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"status":  "cleared",
		"product": product,
	})
}

// ---------------------------------------------------------------------------
// GET /reports/{ts}/html/* — serve archived HTML reports
// ---------------------------------------------------------------------------

func handleReports(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/reports/")
	slashIdx := strings.Index(rest, "/")
	if slashIdx == -1 {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	ts := rest[:slashIdx]
	filePart := rest[slashIdx+1:]

	if strings.Contains(ts, "..") || strings.Contains(filePart, "..") {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	absPath := filepath.Join(rootDir, "reports", "runs", ts, filePart)
	if !safeChild(rootDir, absPath) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	http.ServeFile(w, r, absPath)
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

func main() {
	mux := http.NewServeMux()

	mux.HandleFunc("/api/run/output", handleRunOutput)
	mux.HandleFunc("/api/run", handleRun)
	mux.HandleFunc("/api/upload", handleUpload)
	mux.HandleFunc("/api/codegen", handleCodegen)
	mux.HandleFunc("/api/runs/", handleRunsItem)
	mux.HandleFunc("/api/runs", handleRunsList)
	mux.HandleFunc("/api/screenshot", handleScreenshot)
	mux.HandleFunc("/api/auth/", handleAuth)
	mux.HandleFunc("/reports/", handleReports)

	handler := corsMiddleware(mux)

	log.Printf("Ardoise test dashboard listening on http://localhost%s", serverPort)
	log.Printf("Project root: %s", rootDir)
	log.Fatal(http.ListenAndServe(serverPort, handler))
}
