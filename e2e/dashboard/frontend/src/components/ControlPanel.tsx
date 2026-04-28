import { useEffect, useRef, useState } from 'react';
import s from './ControlPanel.module.css';

// ── Types ──────────────────────────────────────────────────────────────────

interface RunOutput {
  status: 'idle' | 'running' | 'done' | 'failed';
  product: string;
  lines: string[];
  totalLines: number;
  exitCode: number;
}

interface AuthInfo {
  product: string;
  hasCache: boolean;
  age?: string;
  expired: boolean;
}

const PRODUCT_LABELS: Record<string, string> = {
  all: 'All Tests',
  ui:  'UI (Student)',
  mc:  'Mission Control',
  sw:  'Studio Web',
};

const AUTH_LABELS: Record<string, string> = {
  mc:  'Mission Control',
  ui:  'UI (Student)',
  sw:  'Studio Web',
};

// ── Component ──────────────────────────────────────────────────────────────

export function ControlPanel() {
  // Run state
  const [runStatus, setRunStatus]     = useState<RunOutput['status']>('idle');
  const [runProduct, setRunProduct]   = useState('');
  const [logLines, setLogLines]       = useState<string[]>([]);
  const [offsetRef]                   = useState({ current: 0 });
  const pollRef                       = useRef<ReturnType<typeof setInterval> | null>(null);
  const logEndRef                     = useRef<HTMLDivElement>(null);

  // Codegen state
  const [codegenProduct, setCodegenProduct] = useState('');
  const [codegenMsg, setCodegenMsg]         = useState('');

  // Auth state
  const [authStatus, setAuthStatus]   = useState<AuthInfo[]>([]);
  const [authLoading, setAuthLoading] = useState(false);

  // ── Load auth status on mount ──────────────────────────────────────────
  useEffect(() => {
    loadAuthStatus();
  }, []);

  // ── Auto-scroll log ────────────────────────────────────────────────────
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logLines]);

  // ── Cleanup poll on unmount ────────────────────────────────────────────
  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  // ── Helpers ────────────────────────────────────────────────────────────

  function startPolling() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res  = await fetch(`/api/run/output?offset=${offsetRef.current}`);
        const data: RunOutput = await res.json();

        if (data.lines.length > 0) {
          setLogLines(prev => [...prev, ...data.lines]);
          offsetRef.current += data.lines.length;
        }

        setRunStatus(data.status);
        setRunProduct(data.product);

        if (data.status !== 'running') {
          clearInterval(pollRef.current!);
          pollRef.current = null;
        }
      } catch {
        // network error — keep polling
      }
    }, 400);
  }

  async function handleRun(product: string) {
    // Reset log
    setLogLines([]);
    offsetRef.current = 0;
    setRunStatus('running');
    setRunProduct(product);

    try {
      const res = await fetch('/api/run', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ product }),
      });

      if (res.status === 409) {
        alert('A test run is already in progress. Please wait for it to finish.');
        setRunStatus('idle');
        return;
      }
      if (!res.ok) {
        const text = await res.text();
        setLogLines([`Error starting run: ${text}`]);
        setRunStatus('failed');
        return;
      }

      startPolling();
    } catch (err) {
      setLogLines([`Network error: ${err}`]);
      setRunStatus('failed');
    }
  }

  async function handleCodegen(product: string) {
    setCodegenProduct(product);
    setCodegenMsg('');

    try {
      const res = await fetch('/api/codegen', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ product }),
      });

      if (!res.ok) {
        const text = await res.text();
        setCodegenMsg(`Error: ${text}`);
      } else {
        setCodegenMsg(
          `Browser is opening for ${PRODUCT_LABELS[product]}. ` +
          `Click through your test flow, then close the Playwright Inspector. ` +
          `Your recording will be saved to e2e/specs/recorded/recorded.spec.ts`
        );
      }
    } catch (err) {
      setCodegenMsg(`Network error: ${err}`);
    }
  }

  async function loadAuthStatus() {
    setAuthLoading(true);
    try {
      const res  = await fetch('/api/auth/status');
      const data = await res.json();
      setAuthStatus(data);
    } catch {
      // ignore
    } finally {
      setAuthLoading(false);
    }
  }

  async function clearAuth(product: string) {
    await fetch(`/api/auth/${product}`, { method: 'DELETE' });
    loadAuthStatus();
  }

  const isRunning = runStatus === 'running';

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className={s.panel}>

      {/* ── Run Tests ───────────────────────────────────────────────────── */}
      <section className={s.section}>
        <div className={s.sectionHeader}>
          <span className={s.sectionIcon}>▶</span>
          <div>
            <h2 className={s.sectionTitle}>Run Tests</h2>
            <p className={s.sectionSub}>Click a button to start a test run. Results save automatically.</p>
          </div>
        </div>

        <div className={s.runButtons}>
          {(['all', 'ui', 'mc', 'sw'] as const).map(p => (
            <button
              key={p}
              className={`${s.runBtn} ${p === 'all' ? s.runBtnAll : ''}`}
              disabled={isRunning}
              onClick={() => handleRun(p)}
            >
              {isRunning && runProduct === p ? (
                <><span className={s.spinner} /> Running…</>
              ) : (
                PRODUCT_LABELS[p]
              )}
            </button>
          ))}
        </div>

        {/* Live log */}
        {(logLines.length > 0 || isRunning) && (
          <div className={s.logWrap}>
            <div className={s.logHeader}>
              <span className={s.logTitle}>
                {isRunning
                  ? `Running ${PRODUCT_LABELS[runProduct] ?? runProduct}…`
                  : runStatus === 'done'
                    ? `✅ Finished — ${PRODUCT_LABELS[runProduct] ?? runProduct}`
                    : `❌ Failed — ${PRODUCT_LABELS[runProduct] ?? runProduct}`}
              </span>
              {!isRunning && (
                <button
                  className={s.clearLogBtn}
                  onClick={() => { setLogLines([]); setRunStatus('idle'); }}
                >
                  Clear
                </button>
              )}
            </div>

            <div className={s.log}>
              {logLines.map((line, i) => (
                <div key={i} className={`${s.logLine} ${colorLine(line)}`}>
                  {line || '\u00A0'}
                </div>
              ))}
              {isRunning && <div className={s.logCursor}>▋</div>}
              <div ref={logEndRef} />
            </div>
          </div>
        )}
      </section>

      {/* ── Record New Test ─────────────────────────────────────────────── */}
      <section className={s.section}>
        <div className={s.sectionHeader}>
          <span className={s.sectionIcon}>⏺</span>
          <div>
            <h2 className={s.sectionTitle}>Record a New Test</h2>
            <p className={s.sectionSub}>
              Opens your browser already logged in. Click through what you want to test,
              then close the Playwright Inspector window — your test is saved automatically.
            </p>
          </div>
        </div>

        <div className={s.codegenButtons}>
          {(['ui', 'mc', 'sw'] as const).map(p => (
            <button
              key={p}
              className={s.codegenBtn}
              onClick={() => handleCodegen(p)}
            >
              Record {PRODUCT_LABELS[p]}
            </button>
          ))}
        </div>

        {codegenMsg && (
          <div className={`${s.codegenMsg} ${codegenMsg.startsWith('Error') ? s.codegenMsgError : s.codegenMsgOk}`}>
            <strong>{codegenMsg.startsWith('Error') ? '❌' : '⏺'}</strong>
            &nbsp;{codegenMsg}
            {!codegenMsg.startsWith('Error') && (
              <div className={s.codegenSaved}>
                Saved to: <code>e2e/specs/recorded/recorded.spec.ts</code>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── Auth Sessions ───────────────────────────────────────────────── */}
      <section className={s.section}>
        <div className={s.sectionHeader}>
          <span className={s.sectionIcon}>🔑</span>
          <div>
            <h2 className={s.sectionTitle}>Auth Sessions</h2>
            <p className={s.sectionSub}>
              Sessions are cached for 23 hours. Clear a session to force a fresh login on next run.
            </p>
          </div>
          <button
            className={s.refreshBtn}
            onClick={loadAuthStatus}
            disabled={authLoading}
          >
            {authLoading ? 'Refreshing…' : '↻ Refresh'}
          </button>
        </div>

        <div className={s.authList}>
          {authStatus.length === 0 && (
            <div className={s.authEmpty}>Loading session status…</div>
          )}
          {authStatus.map(a => (
            <div key={a.product} className={s.authRow}>
              <div className={s.authProduct}>{AUTH_LABELS[a.product] ?? a.product}</div>
              <div className={`${s.authBadge} ${a.expired || !a.hasCache ? s.authBadgeExpired : s.authBadgeValid}`}>
                {!a.hasCache
                  ? '⚪ No session'
                  : a.expired
                    ? `⚠️ Expired (${a.age})`
                    : `✅ Valid (${a.age})`}
              </div>
              {a.hasCache && (
                <button
                  className={s.clearBtn}
                  onClick={() => clearAuth(a.product)}
                  title="Clear cached session — forces re-login on next run"
                >
                  Clear
                </button>
              )}
            </div>
          ))}
        </div>

        <div className={s.authNote}>
          <strong>Note:</strong> Mission Control requires a Google login — a browser window will
          open automatically on the next test run if the session is cleared.
        </div>
      </section>

    </div>
  );
}

// ── Line colorizer ─────────────────────────────────────────────────────────

function colorLine(line: string): string {
  const l = line.toLowerCase();
  if (l.includes(' failed') || l.includes('error') || l.includes('✗') || l.includes('×')) return s.logFail;
  if (l.includes(' passed') || l.includes('✓') || l.includes('✔'))                        return s.logPass;
  if (l.includes('warning') || l.includes('skipped'))                                       return s.logWarn;
  if (l.startsWith('>') || l.includes('running') || l.includes('playwright'))               return s.logInfo;
  return '';
}
