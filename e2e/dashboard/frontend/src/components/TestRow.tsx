import { useState, useEffect } from 'react';
import type { TestEntry, NetworkLog } from '../types';
import s from './TestRow.module.css';

interface Props {
  test: TestEntry;
}

const PILL_CLASS: Record<string, string> = {
  passed:      'pillPassed',
  expected:    'pillExpected',
  failed:      'pillFailed',
  unexpected:  'pillUnexpected',
  timedOut:    'pillTimedOut',
  skipped:     'pillSkipped',
  interrupted: 'pillInterrupted',
};

const PILL_LABEL: Record<string, string> = {
  passed:      'Passed',
  expected:    'Passed',
  failed:      'Failed',
  unexpected:  'Failed',
  timedOut:    'Timed out',
  skipped:     'Skipped',
  interrupted: 'Interrupted',
};

function fmtDur(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function StatusBadge({ label, count, cls }: { label: string; count: number; cls: string }) {
  if (count === 0) return null;
  return <span className={`${s.netBadge} ${s[cls as keyof typeof s]}`}>{label}: {count}</span>;
}

export function TestRow({ test }: Props) {
  const [expanded, setExpanded]     = useState(false);
  const [netLog, setNetLog]         = useState<NetworkLog | null>(null);
  const [netLogLoading, setLoading] = useState(false);

  const hasFail    = test.status === 'failed' || test.status === 'unexpected' || test.status === 'timedOut';
  const hasDetail  = hasFail && (test.error || test.screenshotPath || test.networkLogPath);
  const pillKey    = PILL_CLASS[test.status] ?? 'pillUnknown';
  const pillLabel  = PILL_LABEL[test.status] ?? test.status;

  const ssUrl = test.screenshotPath
    ? `/api/screenshot?path=${encodeURIComponent(test.screenshotPath)}`
    : null;

  useEffect(() => {
    if (!expanded || !test.networkLogPath || netLog || netLogLoading) return;
    setLoading(true);
    fetch(`/api/attachment?path=${encodeURIComponent(test.networkLogPath)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { setNetLog(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [expanded, test.networkLogPath, netLog, netLogLoading]);

  const netIssueCount = netLog
    ? netLog.consoleErrors.length + netLog.pageErrors.length +
      netLog.failedRequests.length + netLog.apiErrors.length
    : 0;

  return (
    <div className={s.row}>
      <div
        className={s.rowHeader}
        onClick={() => hasDetail && setExpanded(e => !e)}
        style={{ cursor: hasDetail ? 'pointer' : 'default' }}
      >
        {/* Status pill */}
        <span className={`${s.pill} ${s[pillKey as keyof typeof s]}`}>{pillLabel}</span>

        <span className={s.title} title={test.title}>{test.title}</span>

        {test.projectName && (
          <span className={s.project}>{test.projectName}</span>
        )}

        <span className={s.dur}>{fmtDur(test.duration)}</span>

        {test.networkLogPath && !expanded && (
          <span className={s.netWarnBadge} title="Network/API issues captured">⚠️</span>
        )}
      </div>

      {expanded && hasDetail && (
        <div className={s.detail}>

          {/* ── Playwright error ─────────────────────────────────────── */}
          {test.error && (
            <details open>
              <summary style={{ cursor: 'pointer', fontWeight: 600, marginBottom: 6, fontSize: 12, color: 'var(--fail)' }}>
                ❌ Test Error
              </summary>
              <pre className={s.errorBlock}>{test.error}</pre>
            </details>
          )}

          {/* ── Network / API log ─────────────────────────────────── */}
          {test.networkLogPath && (
            <div className={s.netSection}>
              <div className={s.netHeader}>
                🌐 Network &amp; API Errors
                {netLog && (
                  <>
                    <StatusBadge label="Console" count={netLog.consoleErrors.length}  cls="netBadgeConsole" />
                    <StatusBadge label="API"     count={netLog.apiErrors.length}      cls="netBadgeApi" />
                    <StatusBadge label="Net"     count={netLog.failedRequests.length} cls="netBadgeNet" />
                    <StatusBadge label="Crash"   count={netLog.pageErrors.length}     cls="netBadgeCrash" />
                  </>
                )}
              </div>

              {netLogLoading && (
                <div className={s.netBody} style={{ color: 'var(--text-muted)', fontSize: 12 }}>Loading…</div>
              )}

              {netLog && netIssueCount === 0 && (
                <div className={s.netBody} style={{ color: 'var(--pass)', fontSize: 12 }}>✅ No network issues found</div>
              )}

              {netLog && netIssueCount > 0 && (
                <div className={s.netBody}>

                  {netLog.consoleErrors.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <div className={s.netSubtitle}>Console Errors ({netLog.consoleErrors.length})</div>
                      {netLog.consoleErrors.map((e, i) => (
                        <pre key={i} className={s.netEntryPre}>{e}</pre>
                      ))}
                    </div>
                  )}

                  {netLog.pageErrors.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <div className={s.netSubtitle}>Uncaught Exceptions ({netLog.pageErrors.length})</div>
                      {netLog.pageErrors.map((e, i) => (
                        <pre key={i} className={s.netEntryPre}>{e}</pre>
                      ))}
                    </div>
                  )}

                  {netLog.apiErrors.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <div className={s.netSubtitle}>API Errors ({netLog.apiErrors.length})</div>
                      {netLog.apiErrors.map((e, i) => (
                        <div key={i} className={s.netApiRow}>
                          <span className={s.netApiStatus}>{e.status}</span>
                          {' '}<span className={s.netApiMethod}>{e.method}</span>
                          {' '}<span className={s.netApiUrl}>{e.url}</span>
                          {e.responseSnippet && (
                            <div className={s.netApiSnippet}>{e.responseSnippet}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {netLog.failedRequests.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <div className={s.netSubtitle}>Failed Requests ({netLog.failedRequests.length})</div>
                      {netLog.failedRequests.map((r, i) => (
                        <div key={i} className={s.netReqRow}>
                          <span className={s.netReqMethod}>{r.method}</span>
                          {' '}<span className={s.netReqUrl}>{r.url}</span>
                          <span className={s.netReqReason}>↳ {r.reason}</span>
                        </div>
                      ))}
                    </div>
                  )}

                </div>
              )}
            </div>
          )}

          {/* ── Screenshot ─────────────────────────────────────────── */}
          {ssUrl && (
            <div className={s.screenshot}>
              <a href={ssUrl} target="_blank" rel="noreferrer">
                <img src={ssUrl} alt="failure screenshot" className={s.screenshotImg} />
              </a>
            </div>
          )}

          {/* ── Links ──────────────────────────────────────────────── */}
          <div className={s.links}>
            {ssUrl && (
              <a className={s.link} href={ssUrl} target="_blank" rel="noreferrer">
                📷 Screenshot
              </a>
            )}
            {test.tracePath && (
              <span className={s.traceBlock} title={test.tracePath}>
                🔍 <code style={{ fontSize: 11 }}>npx playwright show-trace &quot;{test.tracePath}&quot;</code>
              </span>
            )}
          </div>

        </div>
      )}
    </div>
  );
}
