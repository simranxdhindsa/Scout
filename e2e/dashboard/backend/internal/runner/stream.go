package runner

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"
	"nhooyr.io/websocket"
	"nhooyr.io/websocket/wsjson"
)

// StreamMessage is the JSON envelope sent over the WebSocket to the frontend.
type StreamMessage struct {
	Type    string `json:"type"`    // "stdout" | "stderr" | "status" | "done" | "error"
	Payload string `json:"payload"` // raw text line or status string
	RunID   string `json:"run_id"`
	Time    string `json:"time"` // RFC3339
}

// streamHub manages all active WebSocket connections for a single run.
type streamHub struct {
	mu      sync.RWMutex
	clients map[*websocket.Conn]struct{}
}

func newStreamHub() *streamHub {
	return &streamHub{clients: make(map[*websocket.Conn]struct{})}
}

func (h *streamHub) add(conn *websocket.Conn) {
	h.mu.Lock()
	h.clients[conn] = struct{}{}
	h.mu.Unlock()
}

func (h *streamHub) remove(conn *websocket.Conn) {
	h.mu.Lock()
	delete(h.clients, conn)
	h.mu.Unlock()
}

func (h *streamHub) broadcast(ctx context.Context, msg StreamMessage) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for conn := range h.clients {
		_ = wsjson.Write(ctx, conn, msg)
	}
}

// StreamManager maps run IDs to their stream hubs.
// Thread-safe — multiple goroutines write output while multiple WS clients read.
type StreamManager struct {
	mu   sync.RWMutex
	hubs map[uuid.UUID]*streamHub
}

// NewStreamManager creates a StreamManager.
func NewStreamManager() *StreamManager {
	return &StreamManager{hubs: make(map[uuid.UUID]*streamHub)}
}

// CreateHub initialises a stream hub for a run. Called when a run starts.
func (m *StreamManager) CreateHub(runID uuid.UUID) {
	m.mu.Lock()
	m.hubs[runID] = newStreamHub()
	m.mu.Unlock()
}

// RemoveHub tears down the hub after a run completes.
func (m *StreamManager) RemoveHub(runID uuid.UUID) {
	m.mu.Lock()
	delete(m.hubs, runID)
	m.mu.Unlock()
}

// Publish sends a line of output to all connected WebSocket clients for a run.
func (m *StreamManager) Publish(ctx context.Context, runID uuid.UUID, msgType, payload string) {
	m.mu.RLock()
	hub, ok := m.hubs[runID]
	m.mu.RUnlock()
	if !ok {
		log.Printf("[stream] publish dropped — no hub for run %s (type=%s len=%d)", runID, msgType, len(payload))
		return
	}

	hub.mu.RLock()
	clientCount := len(hub.clients)
	hub.mu.RUnlock()
	log.Printf("[stream] publish run=%s type=%s clients=%d len=%d", runID, msgType, clientCount, len(payload))

	hub.broadcast(ctx, StreamMessage{
		Type:    msgType,
		Payload: payload,
		RunID:   runID.String(),
		Time:    time.Now().UTC().Format(time.RFC3339),
	})
}

// PublishJSON marshals v and publishes it as a "data" message.
func (m *StreamManager) PublishJSON(ctx context.Context, runID uuid.UUID, v any) {
	b, err := json.Marshal(v)
	if err != nil {
		return
	}
	m.Publish(ctx, runID, "data", string(b))
}

// HandleWS upgrades the HTTP connection to WebSocket and registers it with the run's hub.
// It blocks until the client disconnects or the run completes.
func (m *StreamManager) HandleWS(w http.ResponseWriter, r *http.Request, runID uuid.UUID) {
	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true, // origin check handled by CORS middleware
	})
	if err != nil {
		log.Printf("[stream] ws accept error for run %s: %v", runID, err)
		return
	}
	defer conn.CloseNow()

	m.mu.RLock()
	hub, ok := m.hubs[runID]
	hubCount := len(m.hubs)
	m.mu.RUnlock()

	if !ok {
		log.Printf("[stream] WS connected but no hub for run %s (active hubs=%d)", runID, hubCount)
		// Run not active — send a status message and close
		if err := wsjson.Write(r.Context(), conn, StreamMessage{
			Type:    "error",
			Payload: "run not active or already completed",
			RunID:   runID.String(),
			Time:    time.Now().UTC().Format(time.RFC3339),
		}); err != nil {
			log.Printf("[stream] failed to write 'not active' frame: %v", err)
		}
		conn.Close(websocket.StatusNormalClosure, "run not active")
		return
	}

	log.Printf("[stream] WS attached to hub for run %s", runID)
	hub.add(conn)
	defer hub.remove(conn)

	// Keep connection alive — read loop discards any incoming messages
	// and exits when the client disconnects or the context is cancelled
	for {
		_, _, err := conn.Read(r.Context())
		if err != nil {
			return
		}
	}
}
