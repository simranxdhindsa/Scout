package runner

import (
	"context"
	"log"
	"sync"

	"github.com/google/uuid"
)

// RunJob is a unit of work placed onto the queue by the API handler.
// The worker derives its own context from the runner-service lifetime, not
// from the request that enqueued the job — runs outlive HTTP requests.
type RunJob struct {
	RunID  uuid.UUID
	OrgID  uuid.UUID
	IsFlow bool // when true, RunID is a flow_run ID and processFlowRun is called
	Headed bool // when true, Playwright runs with a visible browser window
}

// ActiveRun tracks a run that is currently executing.
type ActiveRun struct {
	RunID  uuid.UUID
	Cancel context.CancelFunc
}

// RunQueue manages a bounded pool of concurrent test runs.
// Runs beyond maxConcurrent are held in the pending channel until a slot opens.
type RunQueue struct {
	maxConcurrent int
	pending       chan *RunJob
	active        sync.Map // map[uuid.UUID]*ActiveRun
	wg            sync.WaitGroup
}

// NewRunQueue creates a queue with the given concurrency limit.
func NewRunQueue(maxConcurrent int) *RunQueue {
	if maxConcurrent < 1 {
		maxConcurrent = 1
	}
	return &RunQueue{
		maxConcurrent: maxConcurrent,
		// Buffer enough pending jobs to avoid blocking the API handler
		pending: make(chan *RunJob, 256),
	}
}

// Enqueue adds a job to the pending queue.
// Returns immediately — the job will be picked up by a worker goroutine.
func (q *RunQueue) Enqueue(job *RunJob) {
	q.pending <- job
}

// StartWorkers launches maxConcurrent worker goroutines that process jobs.
// Should be called once at server startup. Stops when ctx is cancelled.
func (q *RunQueue) StartWorkers(ctx context.Context, processFn func(ctx context.Context, job *RunJob)) {
	sem := make(chan struct{}, q.maxConcurrent)

	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case job, ok := <-q.pending:
				if !ok {
					return
				}
				// Acquire concurrency slot
				sem <- struct{}{}
				q.wg.Add(1)

				go func(j *RunJob) {
					defer func() {
						<-sem // release slot
						q.wg.Done()
						q.active.Delete(j.RunID)
					}()

					runCtx, cancel := context.WithCancel(ctx)
					q.active.Store(j.RunID, &ActiveRun{
						RunID:  j.RunID,
						Cancel: cancel,
					})

					log.Printf("[queue] starting run %s", j.RunID)
					processFn(runCtx, j)
					log.Printf("[queue] finished run %s", j.RunID)
				}(job)
			}
		}
	}()
}

// Stop cancels a specific active run by ID.
// Returns true if the run was found and cancelled, false if it wasn't active.
func (q *RunQueue) Stop(runID uuid.UUID) bool {
	if val, ok := q.active.Load(runID); ok {
		ar := val.(*ActiveRun)
		ar.Cancel()
		return true
	}
	return false
}

// IsActive returns true if a run is currently executing.
func (q *RunQueue) IsActive(runID uuid.UUID) bool {
	_, ok := q.active.Load(runID)
	return ok
}

// ActiveCount returns the number of currently running jobs.
func (q *RunQueue) ActiveCount() int {
	count := 0
	q.active.Range(func(_, _ any) bool {
		count++
		return true
	})
	return count
}

// PendingCount returns the number of jobs waiting in the queue.
func (q *RunQueue) PendingCount() int {
	return len(q.pending)
}

// Drain waits for all active and pending jobs to complete.
// Used during graceful shutdown.
func (q *RunQueue) Drain() {
	q.wg.Wait()
}
