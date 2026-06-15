package api

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"log"
	"mime"
	"net"
	"net/http"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/apyhub/scout/internal/config"
)

// middlewareChain holds the global middleware configuration.
type middlewareChain struct {
	cfg *config.Config
	ctx context.Context
}

func newMiddlewareChain(ctx context.Context, cfg *config.Config) *middlewareChain {
	return &middlewareChain{cfg: cfg, ctx: ctx}
}

// wrap applies CORS → rate limiter → request logger to the given handler.
func (m *middlewareChain) wrap(next http.Handler) http.Handler {
	return corsMiddleware(m.cfg)(
		rateLimitMiddleware(m.ctx)(
			requestLoggerMiddleware(next),
		),
	)
}

// ── CORS ──────────────────────────────────────────────────────────────────────

func corsMiddleware(cfg *config.Config) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")

			// Allow requests from the configured frontend URL
			allowed := cfg.FrontendURL
			if origin == allowed || cfg.Environment == "development" {
				w.Header().Set("Access-Control-Allow-Origin", origin)
			}

			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Requested-With")
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Access-Control-Max-Age", "86400")

			// Handle preflight
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

// ── Rate limiter ──────────────────────────────────────────────────────────────

type rateLimiter struct {
	mu      sync.Mutex
	clients map[string]*clientBucket
}

type clientBucket struct {
	tokens   int
	lastSeen time.Time
}

const (
	rateLimitRPS   = 60  // requests per second per IP
	rateLimitBurst = 120 // burst capacity
)

func rateLimitMiddleware(ctx context.Context) func(http.Handler) http.Handler {
	rl := &rateLimiter{
		clients: make(map[string]*clientBucket),
	}

	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				rl.mu.Lock()
				for ip, bucket := range rl.clients {
					if time.Since(bucket.lastSeen) > 10*time.Minute {
						delete(rl.clients, ip)
					}
				}
				rl.mu.Unlock()
			}
		}
	}()

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip := clientIP(r)

			rl.mu.Lock()
			bucket, ok := rl.clients[ip]
			if !ok {
				bucket = &clientBucket{tokens: rateLimitBurst}
				rl.clients[ip] = bucket
			}

			// Refill tokens based on elapsed time
			now := time.Now()
			elapsed := now.Sub(bucket.lastSeen).Seconds()
			bucket.tokens += int(elapsed * rateLimitRPS)
			if bucket.tokens > rateLimitBurst {
				bucket.tokens = rateLimitBurst
			}
			bucket.lastSeen = now

			if bucket.tokens <= 0 {
				rl.mu.Unlock()
				http.Error(w, `{"error":"rate limit exceeded"}`, http.StatusTooManyRequests)
				return
			}
			bucket.tokens--
			rl.mu.Unlock()

			next.ServeHTTP(w, r)
		})
	}
}

// clientIP extracts the real client IP, respecting X-Forwarded-For from proxies.
func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		return strings.TrimSpace(parts[0])
	}
	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		return xri
	}
	// Strip port from RemoteAddr. SplitHostPort handles IPv6 ([::1]:1234).
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
}

// ── Request logger ────────────────────────────────────────────────────────────

func requestLoggerMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()

		// Wrap ResponseWriter to capture status code
		rw := &responseWriter{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rw, r)

		duration := time.Since(start)
		log.Printf("[http] %s %s %d %s %s",
			r.Method, r.URL.Path, rw.status,
			duration.Round(time.Millisecond),
			clientIP(r),
		)
	})
}

// responseWriter wraps http.ResponseWriter to capture the status code.
type responseWriter struct {
	http.ResponseWriter
	status int
}

func (rw *responseWriter) WriteHeader(code int) {
	rw.status = code
	rw.ResponseWriter.WriteHeader(code)
}

// Hijack passes the hijack call through to the underlying writer so this
// wrapper doesn't break WebSocket upgrades. Without it, websocket.Accept
// fails with "http.ResponseWriter does not implement http.Hijacker".
func (rw *responseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hj, ok := rw.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, fmt.Errorf("underlying ResponseWriter does not implement http.Hijacker")
	}
	return hj.Hijack()
}

// Flush passes through to the underlying writer so streaming endpoints
// (SSE, etc.) work behind the logging middleware.
func (rw *responseWriter) Flush() {
	if f, ok := rw.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// ── Storage handler (local only) ──────────────────────────────────────────────

type storageHandler struct {
	svc Services
}

func newStorageHandler(svc Services) *storageHandler {
	return &storageHandler{svc: svc}
}

// Serve streams a locally stored file to the client.
func (h *storageHandler) Serve(w http.ResponseWriter, r *http.Request) {
	key := r.PathValue("key")
	if key == "" {
		http.Error(w, `{"error":"missing key"}`, http.StatusBadRequest)
		return
	}

	rc, err := h.svc.Storage.Get(r.Context(), key)
	if err != nil {
		http.Error(w, `{"error":"not found"}`, http.StatusNotFound)
		return
	}
	defer rc.Close()

	// Set content type from the file extension (fall back to sniffing).
	if ct := mime.TypeByExtension(filepath.Ext(key)); ct != "" {
		w.Header().Set("Content-Type", ct)
	}

	// Local files are *os.File (seekable) → use ServeContent for range support
	// (needed for video scrubbing); otherwise stream the bytes directly.
	if rs, ok := rc.(io.ReadSeeker); ok {
		http.ServeContent(w, r, key, time.Time{}, rs)
		return
	}
	if _, err := io.Copy(w, rc); err != nil {
		log.Printf("[storage] stream %s error: %v", key, err)
	}
}
