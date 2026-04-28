export interface ErrorSummary {
  consoleErrors:  number;
  apiErrors:      number;
  failedRequests: number;
  pageErrors:     number;
  topErrors:      string[];
}

export interface RunMeta {
  timestamp: string;   // "Mar-05-2026_02-30-PM"
  label: string;       // "Mar 05, 2026 — 2:30 PM"
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  durationMs: number;
  products: string[];
  errorSummary?: ErrorSummary;
}

export interface Attachment {
  name: string;        // "screenshot" | "trace" | "video"
  path: string;        // absolute Windows path
  contentType: string;
}

export interface TestResultItem {
  status: 'passed' | 'failed' | 'skipped' | 'timedOut' | 'interrupted';
  duration: number;    // ms
  error?: { message?: string; stack?: string };
  attachments: Attachment[];
}

export interface NetworkLog {
  consoleErrors:  string[];
  pageErrors:     string[];
  failedRequests: Array<{ url: string; method: string; reason: string }>;
  apiErrors:      Array<{ url: string; method: string; status: number; responseSnippet: string }>;
}

export interface TestEntry {
  title: string;
  projectName: string;
  status: string;      // from test.status or first result
  duration: number;    // ms (sum of results)
  error?: string;
  screenshotPath?: string;
  tracePath?: string;
  networkLogPath?: string;  // absolute path to network-log.json attachment
}

export interface SpecGroup {
  file: string;        // spec file path (relative to project root)
  tests: TestEntry[];
}
