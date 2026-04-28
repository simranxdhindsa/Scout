import type { RunMeta } from '../types';
import s from './RunList.module.css';

interface Props {
  runs: RunMeta[];
  selected: string | null;
  filter: string;
  onSelect: (ts: string) => void;
  onFilter: (f: string) => void;
}

export function RunList({ runs, selected, filter, onSelect, onFilter }: Props) {
  const allProducts = [...new Set(runs.flatMap(r => r.products))].sort();

  const filtered = filter === 'all'
    ? runs
    : runs.filter(r => r.products.includes(filter));

  return (
    <div className={s.sidebar}>
      <div className={s.sidebarHeader}>
        <span className={s.sidebarLabel}>Test Runs</span>
        <span className={s.countBadge}>{filtered.length}</span>
      </div>

      <div className={s.filter}>
        <select
          className={s.filterSelect}
          value={filter}
          onChange={e => onFilter(e.target.value)}
        >
          <option value="all">All Products</option>
          {allProducts.map(p => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>

      <div className={s.divider} />

      <div className={s.list}>
        {filtered.length === 0 && (
          <div className={s.empty}>
            <span>No runs found</span>
          </div>
        )}

        {filtered.map(run => {
          const total = run.total || 0;
          const passRate = total > 0 ? (run.passed / total) * 100 : 0;
          const barColor = run.failed > 0
            ? (passRate >= 80 ? '#d97706' : '#dc2626')
            : '#059669';
          const dotClass = total === 0 ? s.empty : run.failed > 0 ? s.fail : s.pass;
          const isSelected = run.timestamp === selected;

          const [datePart, timePart] = run.label.split(' — ');
          const shortDate = datePart.replace(/,\s*\d{4}/, '');

          const errCount = run.errorSummary
            ? (run.errorSummary.consoleErrors ?? 0) +
              (run.errorSummary.apiErrors ?? 0) +
              (run.errorSummary.failedRequests ?? 0) +
              (run.errorSummary.pageErrors ?? 0)
            : 0;

          return (
            <div
              key={run.timestamp}
              className={`${s.runCard}${isSelected ? ` ${s.selected}` : ''}`}
              onClick={() => onSelect(run.timestamp)}
            >
              <div className={s.cardTop}>
                <span className={`${s.dot} ${dotClass}`} />
                <span className={s.cardDate}>{shortDate}</span>
                <span className={s.cardTime}>{timePart}</span>
              </div>

              <div className={s.cardMeta}>
                {run.passed > 0 && <span className={s.countPass}>✅ {run.passed}</span>}
                {run.failed > 0 && <span className={s.countFail}>❌ {run.failed}</span>}
                {run.skipped > 0 && <span className={s.countSkip}>⏭ {run.skipped}</span>}
                {errCount > 0 && (
                  <span className={s.errorBadge}>⚠ {errCount} issues</span>
                )}
              </div>

              {total > 0 && (
                <div className={s.progressBar}>
                  <div
                    className={s.progressFill}
                    style={{ width: `${passRate}%`, background: barColor }}
                  />
                </div>
              )}

              {run.products.length > 0 && (
                <div className={s.tags}>
                  {run.products.map(p => (
                    <span key={p} className={s.tag}>{p}</span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
