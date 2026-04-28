/**
 * save-report.js
 * Runs after each `pw:test*` command.
 * Copies results.json + html/ into a timestamped folder under e2e/reports/runs/.
 * Timestamp format: Mar-05-2026_02-30-PM (12-hour IST)
 */

const fs   = require('fs');
const path = require('path');

// ── Paths ──────────────────────────────────────────────────────────────────
const ROOT       = path.resolve(__dirname, '..'); // e2e/
const REPORTS    = path.join(ROOT, 'reports');
const RESULTS    = path.join(REPORTS, 'results.json');
const HTML_DIR   = path.join(REPORTS, 'html');
const RUNS_DIR   = path.join(REPORTS, 'runs');

// ── Timestamp (12-hour IST) ────────────────────────────────────────────────
function makeTimestamp() {
  const now = new Date();
  // Use Intl.DateTimeFormat parts for reliable parsing on all platforms
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    month:    'short',   // Mar
    day:      '2-digit', // 05
    year:     'numeric', // 2026
    hour:     '2-digit', // 02
    minute:   '2-digit', // 30
    hour12:   true,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]));
  // Build: "Mar-05-2026_02-30-PM"
  const min    = parts.minute;          // "30"
  const hour   = parts.hour;            // "02"
  const ampm   = parts.dayPeriod;       // "AM" | "PM"
  const day    = parts.day;             // "05"
  const month  = parts.month;           // "Mar"
  const year   = parts.year;            // "2026"
  return `${month}-${day}-${year}_${hour}-${min}-${ampm}`;
}

function makeLabel(ts) {
  // "Mar-05-2026_02-30-PM" → "Mar 05, 2026 — 2:30 PM"
  const [datePart, timePart] = ts.split('_');
  const [mon, day, year] = datePart.split('-');
  const timeDashes = timePart.split('-'); // ["02","30","PM"]
  const ampm = timeDashes.pop();
  const time = timeDashes.join(':').replace(/^0/, ''); // "2:30"
  return `${mon} ${day}, ${year} — ${time} ${ampm}`;
}

// ── Parse results.json ─────────────────────────────────────────────────────
function parseResults(data) {
  let passed = 0, failed = 0, skipped = 0, durationMs = 0;
  const products = new Set();

  function walkSuites(suites) {
    if (!Array.isArray(suites)) return;
    for (const suite of suites) {
      if (Array.isArray(suite.specs)) {
        for (const spec of suite.specs) {
          if (Array.isArray(spec.tests)) {
            for (const test of spec.tests) {
              // Collect project name
              if (test.projectName) products.add(test.projectName);
              // Aggregate results
              if (Array.isArray(test.results)) {
                for (const result of test.results) {
                  durationMs += result.duration || 0;
                }
              }
              // Status
              const status = test.status || (test.results?.[0]?.status);
              if (status === 'passed' || status === 'expected') passed++;
              else if (status === 'failed' || status === 'unexpected') failed++;
              else if (status === 'skipped') skipped++;
            }
          }
        }
      }
      // Recurse into nested suites
      if (Array.isArray(suite.suites)) walkSuites(suite.suites);
    }
  }

  walkSuites(data.suites);

  return {
    passed,
    failed,
    skipped,
    total: passed + failed + skipped,
    durationMs,
    products: [...products],
  };
}

// ── Extract error summary from network-log attachments ────────────────────
function extractErrorSummary(data) {
  let consoleErrors = 0, apiErrors = 0, failedRequests = 0, pageErrors = 0;
  const topErrors = [];

  function walkSuites(suites) {
    if (!Array.isArray(suites)) return;
    for (const suite of suites) {
      for (const spec of suite.specs ?? []) {
        for (const test of spec.tests ?? []) {
          for (const result of test.results ?? []) {
            for (const att of result.attachments ?? []) {
              if (att.name === 'network-log' && att.path && fs.existsSync(att.path)) {
                try {
                  const log = JSON.parse(fs.readFileSync(att.path, 'utf8'));
                  consoleErrors   += log.consoleErrors?.length  ?? 0;
                  apiErrors       += log.apiErrors?.length      ?? 0;
                  failedRequests  += log.failedRequests?.length ?? 0;
                  pageErrors      += log.pageErrors?.length     ?? 0;
                  // Collect representative error messages (max 2 per test)
                  for (const e of (log.consoleErrors ?? []).slice(0, 2))
                    topErrors.push(e.slice(0, 120));
                  for (const e of (log.apiErrors ?? []).slice(0, 2))
                    topErrors.push(`${e.status} ${e.method} ${e.url}`);
                } catch { /* ignore unreadable attachments */ }
              }
            }
          }
        }
      }
      walkSuites(suite.suites ?? []);
    }
  }

  walkSuites(data.suites ?? []);

  return {
    consoleErrors,
    apiErrors,
    failedRequests,
    pageErrors,
    topErrors: topErrors.slice(0, 5),
  };
}

// ── Main ───────────────────────────────────────────────────────────────────
function main() {
  // Guard: results.json must exist
  if (!fs.existsSync(RESULTS)) {
    console.warn('[save-report] results.json not found — skipping archive.');
    return;
  }

  const ts    = makeTimestamp();
  const dest  = path.join(RUNS_DIR, ts);

  fs.mkdirSync(dest, { recursive: true });

  // 1. Copy results.json
  fs.copyFileSync(RESULTS, path.join(dest, 'results.json'));

  // 2. Copy html/ report (if it exists)
  if (fs.existsSync(HTML_DIR)) {
    fs.cpSync(HTML_DIR, path.join(dest, 'html'), { recursive: true });
  }

  // 3. Write meta.json
  let stats        = { passed: 0, failed: 0, skipped: 0, total: 0, durationMs: 0, products: [] };
  let errorSummary = { consoleErrors: 0, apiErrors: 0, failedRequests: 0, pageErrors: 0, topErrors: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(RESULTS, 'utf8'));
    stats        = parseResults(raw);
    errorSummary = extractErrorSummary(raw);
  } catch (e) {
    console.warn('[save-report] Could not parse results.json for stats:', e.message);
  }

  const meta = {
    timestamp: ts,
    label:     makeLabel(ts),
    ...stats,
    errorSummary,
  };

  fs.writeFileSync(path.join(dest, 'meta.json'), JSON.stringify(meta, null, 2));

  const errCount = errorSummary.consoleErrors + errorSummary.apiErrors + errorSummary.failedRequests + errorSummary.pageErrors;
  console.log(`[save-report] ✅ Saved run → ${dest}`);
  console.log(`[save-report]    ${meta.label} | ✅${meta.passed} ❌${meta.failed} ⏭${meta.skipped} | ${(meta.durationMs / 1000).toFixed(1)}s${errCount ? ` | ⚠️ ${errCount} network issues` : ''}`);
}

main();
