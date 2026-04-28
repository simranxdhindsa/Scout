import type { RunMeta } from '../types';
import s from './SummaryBar.module.css';

interface Props {
  meta: RunMeta;
  ts: string;
}

function fmt(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.round(ms / 100) / 10;
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const remainder = Math.round(sec % 60);
  return `${m}m ${remainder}s`;
}

export function SummaryBar({ meta, ts }: Props) {
  const reportUrl = `/reports/${ts}/html/index.html`;
  const passRate = meta.total > 0 ? Math.round((meta.passed / meta.total) * 100) : 0;
  const barColor = passRate === 100 ? '#059669' : passRate >= 80 ? '#d97706' : '#dc2626';

  return (
    <div className={s.bar}>
      {/* Stat cards */}
      <div className={`${s.statCard} ${s.pass}`}>
        <span className={s.statLabel}>Passed</span>
        <span className={s.statValue}>{meta.passed}</span>
      </div>
      <div className={`${s.statCard} ${s.fail}`}>
        <span className={s.statLabel}>Failed</span>
        <span className={s.statValue}>{meta.failed}</span>
      </div>
      <div className={`${s.statCard} ${s.skip}`}>
        <span className={s.statLabel}>Skipped</span>
        <span className={s.statValue}>{meta.skipped}</span>
      </div>

      {/* Right panel */}
      <div className={s.right}>
        <div className={s.rateRow}>
          <span className={s.rateLabel}>Pass rate</span>
          <div className={s.rateTrack}>
            <div
              className={s.rateFill}
              style={{
                width: `${passRate}%`,
                background: `linear-gradient(90deg, ${barColor} 0%, ${barColor}cc 100%)`,
              }}
            />
          </div>
          <span className={s.ratePct} style={{ color: barColor }}>{passRate}%</span>
        </div>

        <div className={s.metaRow}>
          <span className={s.dur}>⏱ {fmt(meta.durationMs)}</span>
          {meta.products.map(p => (
            <span key={p} className={s.productTag}>{p}</span>
          ))}
          <a
            className={s.reportBtn}
            href={reportUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open Full Report ↗
          </a>
        </div>
      </div>
    </div>
  );
}
