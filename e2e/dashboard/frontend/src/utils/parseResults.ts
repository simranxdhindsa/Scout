import type { SpecGroup, TestEntry, Attachment } from '../types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function walkSuites(suites: any[], groups: Map<string, TestEntry[]>, fileKey: string) {
  for (const suite of suites ?? []) {
    const key = suite.file ?? suite.title ?? fileKey;
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const results = test.results ?? [];
        const firstResult = results[0] ?? {};
        const status = test.status ?? firstResult.status ?? 'unknown';
        const duration = results.reduce((sum: number, r: { duration?: number }) => sum + (r.duration ?? 0), 0);

        const attachments: Attachment[] = firstResult.attachments ?? [];
        const screenshot   = attachments.find((a: Attachment) => a.name === 'screenshot' || a.contentType?.startsWith('image/'));
        const trace        = attachments.find((a: Attachment) => a.name === 'trace' || a.contentType === 'application/zip');
        const networkLogAt = attachments.find((a: Attachment) => a.name === 'network-log');

        const entry: TestEntry = {
          title:          spec.title ?? test.title ?? 'Untitled',
          projectName:    test.projectName ?? '',
          status,
          duration,
          screenshotPath: screenshot?.path,
          tracePath:      trace?.path,
          networkLogPath: networkLogAt?.path,
        };

        if (firstResult.error) {
          // Show full stack trace (no truncation — dashboard handles display)
          const msg = firstResult.error.message ?? firstResult.error.stack ?? '';
          entry.error = msg;
        }

        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(entry);
      }
    }
    if (suite.suites?.length) walkSuites(suite.suites, groups, key);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseResults(data: any): SpecGroup[] {
  const groups = new Map<string, TestEntry[]>();
  walkSuites(data.suites ?? [], groups, 'unknown');

  return [...groups.entries()].map(([file, tests]) => ({ file, tests }));
}
