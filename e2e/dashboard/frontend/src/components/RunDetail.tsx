import { useEffect, useState } from 'react';
import type { RunMeta, SpecGroup } from '../types';
import { parseResults } from '../utils/parseResults';
import { SummaryBar } from './SummaryBar';
import { TestRow } from './TestRow';
import s from './RunDetail.module.css';

interface Props {
  meta: RunMeta;
}

export function RunDetail({ meta }: Props) {
  const [groups, setGroups] = useState<SpecGroup[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/runs/${meta.timestamp}/results`)
      .then(r => r.json())
      .then(data => {
        setGroups(parseResults(data));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [meta.timestamp]);

  if (loading) {
    return (
      <div className={s.panel}>
        <div className={s.header}>
          <div className={s.title}>{meta.label}</div>
        </div>
        <div className={`${s.skeleton} ${s.skeletonSummary}`} />
        {[1, 2, 3, 4].map(i => (
          <div key={i} className={`${s.skeleton} ${s.skeletonRow}`} />
        ))}
      </div>
    );
  }

  return (
    <div className={s.panel}>
      <div className={s.header}>
        <div className={s.title}>{meta.label}</div>
        <SummaryBar meta={meta} ts={meta.timestamp} />
      </div>

      {groups.length === 0 && (
        <div className={s.noRuns}>No test data found for this run.</div>
      )}

      {groups.map(group => {
        const passCount = group.tests.filter(
          t => t.status === 'passed' || t.status === 'expected',
        ).length;
        const failCount = group.tests.filter(
          t => t.status === 'failed' || t.status === 'unexpected' || t.status === 'timedOut',
        ).length;
        const label = group.file.replace(/\\/g, '/').split('/').slice(-3).join('/');
        const groupClass = `${s.specGroup}${failCount > 0 ? ` ${s.hasFail}` : ` ${s.allPass}`}`;

        return (
          <details key={group.file} className={groupClass} open={failCount > 0}>
            <summary className={s.specSummary}>
              <span className={s.chevron}>▶</span>
              <span className={s.fileName} title={group.file}>{label}</span>
              <span className={s.counts}>
                {failCount > 0 && <span className={s.countFail}>❌ {failCount}</span>}
                <span className={s.countPass}>✅ {passCount}</span>
                <span className={s.countTotal}>/ {group.tests.length}</span>
              </span>
            </summary>
            {group.tests.map((test, i) => (
              <TestRow key={i} test={test} />
            ))}
          </details>
        );
      })}
    </div>
  );
}
