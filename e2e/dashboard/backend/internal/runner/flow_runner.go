package runner

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/apyhub/scout/internal/db/queries"
	"github.com/google/uuid"
)

// FlowRunJob is the queue payload for a flow run.
type FlowRunJob struct {
	FlowRunID uuid.UUID
	OrgID     uuid.UUID
}

// EnqueueFlow adds a flow run to the processing queue as a special job.
// The queue is run-generic; we wrap the flow execution in a RunJob-shaped closure
// by using a sentinel RunID (the FlowRunID itself) so the queue machinery works.
func (s *Service) EnqueueFlow(job *FlowRunJob) {
	s.queue.Enqueue(&RunJob{
		RunID: job.FlowRunID,
		OrgID: job.OrgID,
		IsFlow: true,
	})
}

// processFlowRun is called by the worker when IsFlow == true.
// It executes each flow step sequentially, threading shared state between them.
func (s *Service) processFlowRun(ctx context.Context, job *RunJob) {
	flowRunID := job.RunID
	orgID := job.OrgID
	log.Printf("[flow] starting flow_run %s", flowRunID)

	flowQ := queries.NewFlowQueries(s.db)

	// Mark as running
	if err := flowQ.UpdateRunStatus(ctx, flowRunID, "running"); err != nil {
		log.Printf("[flow] failed to mark running: %v", err)
		return
	}

	// Load the flow run to get the flow definition
	flowRun, err := flowQ.GetRunByID(ctx, flowRunID)
	if err != nil {
		log.Printf("[flow] get flow_run failed: %v", err)
		_ = flowQ.UpdateRunStatus(ctx, flowRunID, "failed")
		return
	}

	// Load ordered steps
	steps, err := flowQ.ListSteps(ctx, flowRun.FlowID)
	if err != nil {
		log.Printf("[flow] list steps failed: %v", err)
		_ = flowQ.UpdateRunStatus(ctx, flowRunID, "failed")
		return
	}

	// Parse current shared state
	sharedState := map[string]string{}
	if len(flowRun.SharedState) > 0 {
		_ = json.Unmarshal(flowRun.SharedState, &sharedState)
	}

	// Execute steps sequentially
	for _, step := range steps {
		stepRun, err := flowQ.CreateStepRun(ctx, flowRunID, step.ID)
		if err != nil {
			log.Printf("[flow] create step_run for step %s: %v", step.ID, err)
			_ = flowQ.UpdateRunStatus(ctx, flowRunID, "failed")
			return
		}

		_ = flowQ.UpdateStepRun(ctx, stepRun.ID, "running", nil)

		// Build extra env vars by injecting shared state keys this step declared
		extraEnv := map[string]string{}
		var inputs []struct {
			Key  string `json:"key"`
			From string `json:"from"`
		}
		if len(step.EnvInputs) > 0 {
			_ = json.Unmarshal(step.EnvInputs, &inputs)
		}
		for _, inp := range inputs {
			if v, ok := sharedState[inp.From]; ok {
				extraEnv[inp.Key] = v
			}
		}

		// Collect test case IDs for this step
		testCaseIDs, err := s.resolveStepTargets(ctx, step)
		if err != nil || len(testCaseIDs) == 0 {
			log.Printf("[flow] step %s has no test cases: %v", step.ID, err)
			_ = flowQ.UpdateStepRun(ctx, stepRun.ID, "skipped", nil)
			continue
		}

		// Create a regular test_run record for this step execution
		testRunID, stepOutput, stepStatus := s.executeStepAsRun(ctx, orgID, step, testCaseIDs, extraEnv)

		// Link the underlying test_run to this step_run
		_ = flowQ.UpdateStepRun(ctx, stepRun.ID, stepStatus, testRunID)

		if stepStatus == "failed" {
			_ = flowQ.UpdateRunStatus(ctx, flowRunID, "failed")
			_ = s.notif.NotifyOrg(ctx, orgID, nil, "flow_failed",
				"Flow run failed",
				fmt.Sprintf("Step '%s' failed in flow '%s'", step.Name, flowRun.FlowName),
				nil)
			log.Printf("[flow] flow_run %s failed at step %s", flowRunID, step.Name)
			return
		}

		// Extract output vars from stdout and merge into shared state
		var outputs []struct {
			From string `json:"from"`
			To   string `json:"to"`
		}
		if len(step.EnvOutputs) > 0 {
			_ = json.Unmarshal(step.EnvOutputs, &outputs)
		}
		for _, out := range outputs {
			if v := extractOutputVar(stepOutput, out.From); v != "" {
				sharedState[out.To] = v
			}
		}

		// Persist updated shared state after each step
		_ = flowQ.UpdateSharedState(ctx, flowRunID, sharedState)
	}

	_ = flowQ.UpdateRunStatus(ctx, flowRunID, "passed")
	_ = s.notif.NotifyOrg(ctx, orgID, nil, "flow_complete",
		"Flow run completed",
		fmt.Sprintf("All steps passed in flow '%s'", flowRun.FlowName),
		nil)
	log.Printf("[flow] flow_run %s completed successfully", flowRunID)
}

// resolveStepTargets converts a flow step into a list of test case IDs.
func (s *Service) resolveStepTargets(ctx context.Context, step queries.FlowStep) ([]uuid.UUID, error) {
	if step.TestCaseID != nil {
		return []uuid.UUID{*step.TestCaseID}, nil
	}
	if step.FolderID != nil {
		folderIDs, err := s.folderQ.GetSubtreeIDs(ctx, *step.FolderID)
		if err != nil {
			return nil, err
		}
		var ids []uuid.UUID
		for _, fid := range folderIDs {
			tests, err := s.testQ.ListByFolder(ctx, fid)
			if err != nil {
				continue
			}
			for _, t := range tests {
				ids = append(ids, t.ID)
			}
		}
		return ids, nil
	}
	return nil, nil
}

// executeStepAsRun runs the test cases for a single flow step and returns
// (testRunID, collectedOutput, "passed"|"failed").
func (s *Service) executeStepAsRun(
	ctx context.Context,
	orgID uuid.UUID,
	step queries.FlowStep,
	testCaseIDs []uuid.UUID,
	extraEnv map[string]string,
) (*uuid.UUID, string, string) {

	// Create a test_run record so results are visible on the runs page
	run, err := s.runQ.Create(ctx, orgID, nil, nil,
		fmt.Sprintf("[Flow] %s", step.Name), nil)
	if err != nil {
		log.Printf("[flow] create test_run for step %s: %v", step.Name, err)
		return nil, "", "failed"
	}
	for _, tcID := range testCaseIDs {
		id := tcID
		_, _ = s.runQ.CreateItem(ctx, run.ID, &id, nil)
	}
	_ = s.runQ.UpdateStatus(ctx, run.ID, "running")

	// Create workspace + write test files
	ws, err := NewWorkspace(run.ID)
	if err != nil {
		s.failRun(ctx, run.ID, orgID, fmt.Sprintf("workspace: %v", err))
		return &run.ID, "", "failed"
	}
	defer ws.Cleanup(ctx)

	var testFilePaths []string
	for _, tcID := range testCaseIDs {
		tc, err := s.testQ.GetByID(ctx, tcID)
		if err != nil {
			continue
		}
		content := tc.BundledContent
		if content == "" {
			content = tc.FileContent
		}
		p, err := ws.WriteTestFile(tc.FileName, content)
		if err != nil {
			continue
		}
		testFilePaths = append(testFilePaths, p)
	}
	if len(testFilePaths) == 0 {
		s.failRun(ctx, run.ID, orgID, "no test files")
		return &run.ID, "", "failed"
	}

	// Locate playwright project dir
	playwrightProjectDir := os.Getenv("SCOUT_PLAYWRIGHT_PROJECT_DIR")
	if playwrightProjectDir == "" {
		cwd, _ := os.Getwd()
		playwrightProjectDir = FindPlaywrightProjectDir(cwd)
	}
	if playwrightProjectDir == "" {
		s.failRun(ctx, run.ID, orgID, "cannot locate node_modules/@playwright/test")
		return &run.ID, "", "failed"
	}
	if err := ws.LinkNodeModules(filepath.Join(playwrightProjectDir, "node_modules")); err != nil {
		s.failRun(ctx, run.ID, orgID, fmt.Sprintf("link node_modules: %v", err))
		return &run.ID, "", "failed"
	}

	cfgOpts := DefaultConfigOptions(ws.Dir)
	cfgOpts.TestFiles = testFilePaths
	cfgContent := GenerateConfig(cfgOpts)
	if _, err := ws.WriteConfig(cfgContent); err != nil {
		s.failRun(ctx, run.ID, orgID, fmt.Sprintf("write config: %v", err))
		return &run.ID, "", "failed"
	}

	// Build env — inject extra (shared state) vars on top of OS env
	hostNodeModules := filepath.Join(playwrightProjectDir, "node_modules")
	env := append(os.Environ(), "NODE_PATH="+hostNodeModules)
	for k, v := range extraEnv {
		env = append(env, k+"="+v)
	}

	cmd := exec.CommandContext(ctx, "npx", "playwright", "test",
		"--config", filepath.Join(ws.Dir, "playwright.config.ts"))
	cmd.Dir = playwrightProjectDir
	cmd.Env = env

	var outputLines []string
	_ = startAndStream(cmd, func(line string) {
		outputLines = append(outputLines, line)
	})

	collected := strings.Join(outputLines, "\n")

	// Parse results — if Playwright crashed and produced no results file, treat as failed.
	result, _ := ParseResults(ws.ResultsPath())
	finalStatus := "failed"
	if result != nil {
		for _, tr := range result.TestResults {
			s.updateRunItemByName(ctx, run.ID, tr)
		}
		_ = s.runQ.SaveReport(ctx, run.ID,
			result.Passed, result.Failed, result.Skipped, result.TimedOut,
			result.Total, result.DurationMs, "",
			result.ConsoleErrors, result.APIErrors, result.FailedRequests, result.PageErrors)
		if result.Failed == 0 {
			finalStatus = "passed"
		}
	}

	_ = s.runQ.UpdateStatus(ctx, run.ID, finalStatus)
	return &run.ID, collected, finalStatus
}

// extractOutputVar looks for a line `SCOUT_OUTPUT_<key>=<value>` in output and returns the value.
func extractOutputVar(output, key string) string {
	prefix := "SCOUT_OUTPUT_" + strings.ToUpper(key) + "="
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, prefix) {
			return strings.TrimPrefix(line, prefix)
		}
	}
	return ""
}
