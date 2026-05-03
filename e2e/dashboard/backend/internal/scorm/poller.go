package scorm

import (
	"context"
	"log"
	"time"

	"github.com/google/uuid"
)

const (
	pollInterval = 2 * time.Second
	pollTimeout  = 10 * time.Minute
)

// StartPolling launches a background goroutine that polls Phoenix every 2 seconds
// until the job reaches a terminal status (complete / error / failed) or times out.
// On completion it updates the snapshot in the DB and fires an in-app notification.
func (svc *Service) StartPolling(snapshotID uuid.UUID, jobID string, orgID uuid.UUID, userID *uuid.UUID) {
	go func() {
		// Use a fresh background context — the HTTP request context will be cancelled
		// long before the job finishes, so we cannot use it here.
		ctx := context.Background()

		ticker := time.NewTicker(pollInterval)
		defer ticker.Stop()

		timeout := time.NewTimer(pollTimeout)
		defer timeout.Stop()

		log.Printf("[scorm/poller] started polling job %s for snapshot %s", jobID, snapshotID)

		for {
			select {
			case <-timeout.C:
				log.Printf("[scorm/poller] job %s timed out after %s", jobID, pollTimeout)
				if err := svc.db.MarkFailed(ctx, snapshotID, "polling timeout — no response from Phoenix within 10 minutes"); err != nil {
					log.Printf("[scorm/poller] mark failed error: %v", err)
				}
				svc.notifyCompletion(ctx, snapshotID, orgID, userID, "timeout", "")
				return

			case <-ticker.C:
				result, err := svc.phoenix.Status(ctx, jobID)
				if err != nil {
					// Transient error — log and keep polling
					log.Printf("[scorm/poller] status error for job %s: %v", jobID, err)
					continue
				}

				log.Printf("[scorm/poller] job %s status: %s", jobID, result.Status)

				if !IsTerminal(result.Status) {
					// Still processing — keep polling
					continue
				}

				// Terminal status reached — update DB
				if err := svc.db.UpdateSnapshot(ctx, snapshotID, result); err != nil {
					log.Printf("[scorm/poller] update snapshot error: %v", err)
				}

				// Fire in-app notification
				svc.notifyCompletion(ctx, snapshotID, orgID, userID, result.Status, result.Filename)

				log.Printf("[scorm/poller] job %s finished with status %s", jobID, result.Status)
				return
			}
		}
	}()
}

// notifyCompletion sends an in-app notification for a completed SCORM scraping job.
func (svc *Service) notifyCompletion(ctx context.Context, snapshotID uuid.UUID, orgID uuid.UUID, userID *uuid.UUID, status, filename string) {
	if userID == nil || svc.notif == nil {
		return
	}

	var title, message, notifType string

	switch status {
	case "complete":
		notifType = "scorm_complete"
		title = "SCORM scraping complete"
		if filename != "" {
			message = filename + " · Scraping finished successfully"
		} else {
			message = "Scraping finished successfully"
		}
	case "timeout":
		notifType = "scorm_error"
		title = "SCORM scraping timed out"
		message = "No response from Phoenix within 10 minutes"
	default:
		notifType = "scorm_error"
		title = "SCORM scraping failed"
		if filename != "" {
			message = filename + " · Check result for details"
		} else {
			message = "Check result for details"
		}
	}

	metadata := map[string]any{
		"snapshot_id": snapshotID.String(),
	}

	if err := svc.notif.NotifyUser(ctx, *userID, orgID, nil, notifType, title, message, metadata); err != nil {
		log.Printf("[scorm/poller] notify error: %v", err)
	}
}
