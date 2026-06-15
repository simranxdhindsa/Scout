package scheduler

import (
	"context"
	"log"
	"time"

	"github.com/apyhub/scout/internal/db/queries"
	"github.com/apyhub/scout/internal/runner"
	"github.com/gorhill/cronexpr"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Service checks scheduled runs every minute and enqueues any that are due.
type Service struct {
	db     *pgxpool.Pool
	runner *runner.Service
}

func NewService(db *pgxpool.Pool, r *runner.Service) *Service {
	return &Service{db: db, runner: r}
}

// Start launches the background goroutine. Cancel ctx to stop.
func (s *Service) Start(ctx context.Context) {
	go s.loop(ctx)
}

func (s *Service) loop(ctx context.Context) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	// Fire once immediately on start
	s.tick(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.tick(ctx)
		}
	}
}

func (s *Service) tick(ctx context.Context) {
	sq := queries.NewScheduledRunQueries(s.db)
	due, err := sq.ListDue(ctx)
	if err != nil {
		log.Printf("[scheduler] list due: %v", err)
		return
	}
	for _, sched := range due {
		s.fire(ctx, sq, sched)
	}
}

func (s *Service) fire(ctx context.Context, sq *queries.ScheduledRunQueries, sched queries.ScheduledRun) {
	log.Printf("[scheduler] firing scheduled run %s (%s)", sched.ID, sched.Label)

	// Collect test case IDs (direct list or via folder)
	runQ := queries.NewRunQueries(s.db)
	folderQ := queries.NewFolderQueries(s.db)

	var testCaseIDs []uuid.UUID
	if sched.FolderID != nil {
		ids, err := folderQ.GetSubtreeIDs(ctx, *sched.FolderID)
		if err == nil {
			testCaseIDs = ids
		}
	}
	testCaseIDs = append(testCaseIDs, sched.TestCaseIDs...)

	if len(testCaseIDs) == 0 {
		// Advance next_run_at so the schedule doesn't spam every tick; log a warning so operators notice
		log.Printf("[scheduler] WARNING: schedule %s has no test cases — advancing next_run_at without running", sched.ID)
		next := computeNext(sched.CronExpr)
		if err := sq.MarkFired(ctx, sched.ID, next); err != nil {
			log.Printf("[scheduler] mark fired %s: %v", sched.ID, err)
		}
		return
	}

	run, err := runQ.Create(ctx, sched.OrgID, sched.EnvID, sched.CreatedBy,
		"[Scheduled] "+sched.Label, nil)
	if err != nil {
		// Don't advance next_run_at on create failure — retry at next tick
		log.Printf("[scheduler] create run for %s: %v — will retry next tick", sched.ID, err)
		return
	}

	for _, tcID := range testCaseIDs {
		id := tcID
		_, _ = runQ.CreateItem(ctx, run.ID, &id, nil)
	}
	s.runner.Enqueue(&runner.RunJob{RunID: run.ID, OrgID: sched.OrgID})
	log.Printf("[scheduler] enqueued run %s for schedule %s", run.ID, sched.ID)

	next := computeNext(sched.CronExpr)
	if err := sq.MarkFired(ctx, sched.ID, next); err != nil {
		log.Printf("[scheduler] mark fired %s: %v", sched.ID, err)
	}
}

// computeNext parses the cron expression and returns the next run time after now.
func computeNext(expr string) *time.Time {
	e, err := cronexpr.Parse(expr)
	if err != nil {
		log.Printf("[scheduler] invalid cron %q: %v", expr, err)
		return nil
	}
	next := e.Next(time.Now())
	if next.IsZero() {
		return nil
	}
	return &next
}

// NextAfter is exported for use by the API when creating/updating a schedule.
func NextAfter(expr string, after time.Time) *time.Time {
	e, err := cronexpr.Parse(expr)
	if err != nil {
		return nil
	}
	next := e.Next(after)
	if next.IsZero() {
		return nil
	}
	return &next
}
