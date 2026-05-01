#!/usr/bin/env node
// Runs automatically after every `playwright test` invocation via npm scripts.
// Reads reports/results.json, archives a timestamped snapshot, and writes meta.json.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RESULTS_SRC = path.join(ROOT, 'reports', 'results.json');
const HTML_SRC = path.join(ROOT, 'reports', 'html');
const RUNS_DIR = path.join(ROOT, 'reports', 'runs');

// ---------------------------------------------------------------------------
// Timestamp: "May-01-2026_02-30-PM"
// ---------------------------------------------------------------------------
function buildTimestamp() {
  const now = new Date();
  const month = now.toLocaleString('en-US', { month: 'short' });
  const day = String(now.getDate()).padStart(2, '0');
  const year = now.getFullYear();
  let hours = now.getHours();
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  const hourStr = String(hours).padStart(2, '0');
  return `${month}-${day}-${year}_${hourStr}-${minutes}-${ampm}`;
}

// ---------------------------------------------------------------------------
// Recursively collect all test objects from the Playwright JSON report.
// A suite may have .specs[].tests[] and nested .suites[].
// ---------------------------------------------------------------------------
function collectTests(suites = []) {
  const tests = [];
  for (const suite of suites) {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        tests.push(t);
      }
    }
    tests.push(...collectTests(suite.suites));
  }
  return tests;
}

// ---------------------------------------------------------------------------
// Parse network-log attachments. Attachments are base64-encoded inline JSON.
// ---------------------------------------------------------------------------
function parseNetworkLogs(tests) {
  const logs = [];
  for (const test of tests) {
    for (const result of test.results ?? []) {
      for (const att of result.attachments ?? []) {
        if (att.name !== 'network-log') continue;
        try {
          const raw = att.body
            ? Buffer.from(att.body, 'base64').toString('utf-8')
            : att.path
              ? fs.readFileSync(att.path, 'utf-8')
              : null;
          if (raw) logs.push(JSON.parse(raw));
        } catch {
          // malformed attachment — skip
        }
      }
    }
  }
  return logs;
}

// ---------------------------------------------------------------------------
// Build errorSummary from network logs
// ---------------------------------------------------------------------------
function buildErrorSummary(logs) {
  let consoleErrors = 0;
  let apiErrors = 0;
  let failedRequests = 0;
  let pageErrors = 0;
  const messages = [];

  for (const log of logs) {
    const ce = log.consoleErrors ?? [];
    consoleErrors += ce.length;
    messages.push(...ce.map((e) => e.text ?? String(e)));

    const res = log.responses ?? [];
    apiErrors += res.filter((r) => r.status >= 500).length;

    failedRequests += (log.failedRequests ?? []).length;

    const pe = log.pageErrors ?? [];
    pageErrors += pe.length;
    messages.push(...pe.map((e) => e.message ?? String(e)));
  }

  // Top 5 most frequent error messages
  const counts = {};
  for (const msg of messages) {
    const key = String(msg).slice(0, 200); // truncate long messages
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const topErrors = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([message, count]) => ({ message, count }));

  return { consoleErrors, apiErrors, failedRequests, pageErrors, topErrors };
}

// ---------------------------------------------------------------------------
// Copy a directory recursively (Node ≥ 16.7).
// ---------------------------------------------------------------------------
function copyDir(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.cpSync(src, dest, { recursive: true });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  if (!fs.existsSync(RESULTS_SRC)) {
    console.log('[save-report] reports/results.json not found — nothing to archive.');
    return;
  }

  let report;
  try {
    report = JSON.parse(fs.readFileSync(RESULTS_SRC, 'utf-8'));
  } catch (err) {
    console.error('[save-report] Failed to parse results.json:', err.message);
    process.exit(1);
  }

  const stats = report.stats ?? {};
  const tests = collectTests(report.suites ?? []);

  if (tests.length === 0) {
    console.log('[save-report] Zero tests found — archiving empty run anyway.');
  }

  // Aggregate counts
  const passed = stats.expected ?? stats.passed ?? 0;
  const failed = stats.unexpected ?? stats.failed ?? 0;
  const flaky = stats.flaky ?? 0;
  const skipped = stats.skipped ?? 0;
  const total = passed + failed + flaky + skipped;
  const durationMs = Math.round(stats.duration ?? 0);

  // Unique products (project names)
  const products = [...new Set(tests.map((t) => t.projectName).filter(Boolean))];

  // Network error summary
  const networkLogs = parseNetworkLogs(tests);
  const errorSummary = buildErrorSummary(networkLogs);

  // Create archive directory
  const timestamp = buildTimestamp();
  const destDir = path.join(RUNS_DIR, timestamp);
  fs.mkdirSync(destDir, { recursive: true });

  // Copy results + html report
  fs.copyFileSync(RESULTS_SRC, path.join(destDir, 'results.json'));
  copyDir(HTML_SRC, path.join(destDir, 'html'));

  // Write meta.json
  const meta = {
    timestamp,
    label: timestamp.replace(/_/g, ' '),
    passed,
    failed,
    flaky,
    skipped,
    total,
    durationMs,
    products,
    errorSummary,
  };
  fs.writeFileSync(path.join(destDir, 'meta.json'), JSON.stringify(meta, null, 2));

  console.log(
    `[save-report] Archived → reports/runs/${timestamp}/ (${passed}✓ ${failed}✗ ${skipped}– of ${total})`,
  );
}

main();
