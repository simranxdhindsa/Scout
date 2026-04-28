import { useEffect, useState } from 'react';
import type { RunMeta } from './types';
import { RunList } from './components/RunList';
import { RunDetail } from './components/RunDetail';
import { ControlPanel } from './components/ControlPanel';
import s from './App.module.css';

type Tab = 'reports' | 'control';

export function App() {
  const [tab, setTab]         = useState<Tab>('control');
  const [runs, setRuns]       = useState<RunMeta[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter]   = useState('all');
  const [loading, setLoading] = useState(true);

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

  // Refresh run list when switching to Reports tab
  function handleTabChange(next: Tab) {
    setTab(next);
    if (next === 'reports') {
      fetch('/api/runs')
        .then(r => r.json())
        .then((data: RunMeta[]) => {
          setRuns(data);
          if (!selected && data.length > 0) setSelected(data[0].timestamp);
        })
        .catch(() => {});
    }
  }

  const selectedMeta = runs.find(r => r.timestamp === selected) ?? null;

  return (
    <div className={s.app}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className={s.header}>
        <div className={s.headerLogo}>🎭</div>
        <div className={s.headerTitles}>
          <h1 className={s.headerTitle}>Ardoise Test Dashboard</h1>
          <span className={s.headerSub}>End-to-end test monitoring &amp; control</span>
        </div>

        {/* Tab nav */}
        <nav className={s.tabNav}>
          <button
            className={`${s.tabBtn} ${tab === 'control' ? s.tabActive : ''}`}
            onClick={() => handleTabChange('control')}
          >
            ▶ Run &amp; Record
          </button>
          <button
            className={`${s.tabBtn} ${tab === 'reports' ? s.tabActive : ''}`}
            onClick={() => handleTabChange('reports')}
          >
            📋 Reports {runs.length > 0 && <span className={s.tabBadge}>{runs.length}</span>}
          </button>
        </nav>

        {loading && tab === 'reports' && (
          <div className={s.headerRight}>
            <span className={s.loadingDot} />
            <span className={s.loadingLabel}>Loading…</span>
          </div>
        )}
      </header>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <div className={s.body}>

        {tab === 'control' && <ControlPanel />}

        {tab === 'reports' && (
          <>
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
              <div className={s.detailWrap}>
                <div className={s.emptyState}>
                  <span className={s.emptyIcon}>📋</span>
                  {loading
                    ? 'Loading runs…'
                    : runs.length === 0
                      ? 'No test runs yet. Go to "Run & Record" to run your first test.'
                      : 'Select a run from the sidebar'}
                </div>
              </div>
            )}
          </>
        )}

      </div>
    </div>
  );
}
