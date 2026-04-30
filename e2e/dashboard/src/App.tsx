import { useEffect, useRef, useState } from 'react';
import type { RunMeta } from './types';
import { RunList } from './components/RunList';
import { RunDetail } from './components/RunDetail';

type RunStatus = 'idle' | 'running' | 'done' | 'failed' | 'stopped';

export function App() {
  const [runs, setRuns] = useState<RunMeta[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [runStatus, setRunStatus] = useState<RunStatus>('idle');
  const [stopping, setStopping] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch('/api/runs')
      .then(r => r.json())
      .then((data: RunMeta[]) => {
        setRuns(data);
        if (data.length > 0) setSelected(data[0].timestamp);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Poll run status so the Stop button appears/disappears automatically.
  useEffect(() => {
    const poll = () => {
      fetch('/api/run/output?offset=0')
        .then(r => r.json())
        .then((data: { status: RunStatus }) => setRunStatus(data.status))
        .catch(() => {});
    };
    poll();
    pollRef.current = setInterval(poll, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const handleStop = async () => {
    setStopping(true);
    try {
      await fetch('/api/run', { method: 'DELETE' });
      setRunStatus('stopped');
    } catch {
      // ignore — next poll will reflect real state
    } finally {
      setStopping(false);
    }
  };

  const selectedMeta = runs.find(r => r.timestamp === selected) ?? null;

  return (
    <div className="app">
      <header className="app-header">
        <span style={{ fontSize: '20px' }}>🎭</span>
        <h1>Ardoise Test Reports</h1>
        {loading && <span style={{ color: 'var(--text-muted)', fontSize: '12px', marginLeft: 8 }}>Loading…</span>}
        <button
          className="stop-run-btn"
          onClick={handleStop}
          disabled={runStatus !== 'running' || stopping}
          title={runStatus === 'running' ? 'Kill the running Playwright process' : 'No tests are currently running'}
        >
          {stopping ? 'Stopping…' : '⏹ Stop Tests'}
        </button>
      </header>
      <div className="app-body">
        <RunList
          runs={runs}
          selected={selected}
          filter={filter}
          onSelect={setSelected}
          onFilter={setFilter}
        />
        {selectedMeta ? (
          <RunDetail meta={selectedMeta} />
        ) : (
          <div className="detail">
            <div className="detail-empty">
              {loading ? 'Loading runs…' : runs.length === 0
                ? 'No test runs found. Run `npm run pw:test` to generate a report.'
                : 'Select a run from the sidebar'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
