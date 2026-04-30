import { useEffect, useRef, useState, DragEvent, ChangeEvent } from 'react';
import type { GenMeta, Snapshot } from '../types';
import s from './ScormPanel.module.css';

// ── Types ────────────────────────────────────────────────────────────────────

type OutputTab = 'visual' | 'markdown' | 'json';

interface ScrapeResult {
  status?: string;
  job_id?: string;
  language?: string;
  mode?: string;
  coverage_percent?: number;
  elapsed_seconds?: number;
  error?: string;
  authoring_tools_detected?: string[];
  external_links?: string[];
  markdown?: string;
  markdown_list?: Array<{ title?: string; content?: string }>;
  summary?: {
    total_markdowns?: number;
    total_audio_files?: number;
    markdown_titles?: string[];
  };
}

// ── Component ────────────────────────────────────────────────────────────────

export function ScormPanel() {
  const [generators, setGenerators]     = useState<GenMeta[]>([]);
  const [genFilter, setGenFilter]       = useState('all');
  const [snapshots, setSnapshots]       = useState<Snapshot[]>([]);
  const [histFilter, setHistFilter]     = useState('all');

  // Upload state
  const [file, setFileState]            = useState<File | null>(null);
  const [dropHot, setDropHot]           = useState(false);
  const [category, setCategory]         = useState('valid');
  const [genType, setGenType]           = useState('');
  const [notes, setNotes]               = useState('');
  const [uploading, setUploading]       = useState(false);
  const [progress, setProgress]         = useState(0);
  const [polling, setPolling]           = useState(false);
  const [pollText, setPollText]         = useState('');
  const pollRef                         = useRef<ReturnType<typeof setInterval> | null>(null);

  // Result state
  const [result, setResult]             = useState<ScrapeResult | null>(null);
  const [outputTab, setOutputTab]       = useState<OutputTab>('visual');

  // Selected snapshot (right pane)
  const [selected, setSelected]         = useState<Snapshot | null>(null);

  useEffect(() => {
    loadGenerators();
    loadHistory();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  // ── Loaders ────────────────────────────────────────────────────────────────

  async function loadGenerators() {
    try {
      const res = await fetch('/api/scorm/generate/list');
      const data: GenMeta[] = await res.json();
      setGenerators(data);
    } catch { /* proxy offline */ }
  }

  async function loadHistory() {
    try {
      const res = await fetch('/api/scorm/snapshots');
      const data: Snapshot[] = await res.json();
      setSnapshots(data);
    } catch { setSnapshots([]); }
  }

  // ── File handling ──────────────────────────────────────────────────────────

  function pickFile(f: File) {
    setFileState(f);
    setProgress(0);
  }

  function clearUpload() {
    setFileState(null);
    setGenType('');
    setNotes('');
    setProgress(0);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDropHot(false);
    const f = e.dataTransfer.files[0];
    if (f) pickFile(f);
  }

  function onFileInput(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) pickFile(f);
  }

  // ── Generator click ────────────────────────────────────────────────────────

  async function prepareGenerated(gen: GenMeta) {
    try {
      const res = await fetch(`/api/scorm/generate/${encodeURIComponent(gen.type)}`);
      if (!res.ok) throw new Error('Generator failed');
      const blob = await res.blob();
      const f = new File([blob], gen.filename, { type: 'application/zip' });
      pickFile(f);
      setCategory(gen.category);
      setGenType(gen.type);
      setNotes(`Generated: ${gen.name}. Expected: ${gen.expected}`);
    } catch (err) {
      console.error(err);
    }
  }

  // ── Upload & poll ──────────────────────────────────────────────────────────

  async function handleUpload() {
    if (!file || file.size === 0) return;
    if (pollRef.current) clearInterval(pollRef.current);
    setUploading(true);
    setProgress(35);
    setPolling(false);

    try {
      const form = new FormData();
      form.append('file', file);
      form.append('test_category', category);
      form.append('generator_type', genType);
      form.append('notes', notes);

      const res  = await fetch('/api/scorm/upload', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok || !data.job_id) throw new Error(data.error || 'Upload did not return a job_id');

      setProgress(70);
      startPolling(data.job_id, data.snapshot_id);
      loadHistory();
    } catch (err) {
      console.error(err);
      setUploading(false);
      setProgress(0);
    }
  }

  function startPolling(jobID: string, snapshotID: string) {
    setPolling(true);
    let count = 0;
    pollRef.current = setInterval(async () => {
      count++;
      try {
        const res  = await fetch(`/api/scorm/status/${encodeURIComponent(jobID)}?snapshot_id=${encodeURIComponent(snapshotID)}`);
        const data = await res.json();
        setPollText(`Attempt ${count}: ${data.status ?? 'unknown'}${data.step ? ' | ' + data.step : ''}`);
        if (['complete', 'error', 'failed'].includes(data.status)) {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setPolling(false);
          setUploading(false);
          setProgress(100);
          setTimeout(() => setProgress(0), 500);
          setResult(data as ScrapeResult);
          loadHistory();
        }
      } catch { /* keep polling */ }
    }, 2000);
  }

  // ── Snapshot actions ───────────────────────────────────────────────────────

  async function deleteSnapshot(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    await fetch(`/api/scorm/snapshots/${encodeURIComponent(id)}`, { method: 'DELETE' });
    setSnapshots(prev => prev.filter(s => s.id !== id));
    if (selected?.id === id) setSelected(null);
  }

  async function clearAllHistory() {
    if (!confirm('Delete all local snapshots?')) return;
    for (const snap of snapshots) {
      await fetch(`/api/scorm/snapshots/${encodeURIComponent(snap.id)}`, { method: 'DELETE' });
    }
    setSnapshots([]);
    setSelected(null);
  }

  function selectSnapshot(snap: Snapshot) {
    setSelected(snap);
    if (snap.status_response) setResult(snap.status_response as ScrapeResult);
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  const filteredGens = generators.filter(g => genFilter === 'all' || g.category === genFilter);
  const filteredSnaps = snapshots.filter(snap =>
    histFilter === 'all' ||
    snap.test_category === histFilter ||
    snap.status === histFilter,
  );

  const markdownItems: Array<{ title: string; content: string }> = [];
  if (result) {
    (result.markdown_list || []).forEach(item => {
      if (item && (item.content || item.title))
        markdownItems.push({ title: item.title ?? 'Untitled', content: item.content ?? '' });
    });
    if (!markdownItems.length && result.markdown)
      markdownItems.push({ title: 'Markdown', content: result.markdown });
  }

  return (
    <div className={s.shell}>

      {/* ── Left Sidebar ─────────────────────────────────────────────────── */}
      <aside className={s.side}>

        {/* Upload — frozen, does not scroll */}
        <section className={`${s.section} ${s.sideFixed}`}>
          <div className={s.sectionHead}>
            <div>
              <div className={s.eyebrow}>Upload</div>
              <h2 className={s.title}>Run a package</h2>
            </div>
          </div>

          <div
            className={`${s.drop} ${dropHot ? s.dropHot : ''} ${file ? s.dropSelected : ''}`}
            onDragOver={e => { e.preventDefault(); setDropHot(true); }}
            onDragLeave={() => setDropHot(false)}
            onDrop={onDrop}
          >
            <input className={s.dropInput} type="file" accept=".zip,application/zip" onChange={onFileInput} />
            <div>
              <div className={`${s.dropIcon} ${file ? s.dropIconSelected : ''}`}>ZIP</div>
              <strong>Drop a SCORM ZIP here</strong>
              <div className={s.hint}>Local upload through the Go proxy.</div>
            </div>
          </div>

          {file && (
            <div className={s.fileChip}>
              <div className={s.fileBadge}>ZIP</div>
              <div className={s.fileCopy}>
                <span className={s.fileCopyName}>{file.name}</span>
                <div className={s.hint}>{formatBytes(file.size)} | ready for proxy upload</div>
              </div>
            </div>
          )}

          <div className={s.formGrid}>
            <div className={s.row}>
              <select className={s.select} value={category} onChange={e => setCategory(e.target.value)}>
                <option value="valid">Valid test</option>
                <option value="edge">Edge case</option>
                <option value="break">Break test</option>
              </select>
              <input className={s.input} placeholder="Generator type" value={genType} onChange={e => setGenType(e.target.value)} />
            </div>
            <textarea className={s.textarea} placeholder="Run notes, expected behavior…" value={notes} onChange={e => setNotes(e.target.value)} />
          </div>

          <div className={s.actions}>
            <button className={`${s.btn} ${s.btnPrimary}`} disabled={!file || uploading} onClick={handleUpload}>
              {uploading ? 'Uploading…' : 'Upload and poll'}
            </button>
            <button className={s.btn} onClick={clearUpload}>Clear</button>
          </div>

          {progress > 0 && (
            <div className={s.progress}>
              <div className={s.progressFill} style={{ width: `${progress}%` }} />
            </div>
          )}
        </section>

        {/* Generator list — scrollable independently */}
        <section className={`${s.section} ${s.sideScroll}`}>
          <div className={s.sectionHead}>
            <div>
              <div className={s.eyebrow}>Generator</div>
              <h2 className={s.title}>ZIP test cases</h2>
            </div>
          </div>
          <div className={s.genTools}>
            <select className={s.select} value={genFilter} onChange={e => setGenFilter(e.target.value)}>
              <option value="all">All cases</option>
              <option value="valid">Valid</option>
              <option value="edge">Edge</option>
              <option value="break">Break</option>
            </select>
          </div>
          <div className={s.genList}>
            {filteredGens.length === 0
              ? <div className={s.empty}>No generators in this filter.</div>
              : filteredGens.map(gen => (
                <button key={gen.type} className={s.genCard} onClick={() => prepareGenerated(gen)}>
                  <span className={`${s.badge} ${s[gen.category as keyof typeof s] ?? ''}`}>{gen.category}</span>
                  <div className={s.genName}>{gen.name}</div>
                  <div className={s.genDesc}>{gen.description}</div>
                  <div className={s.genExpected}>{gen.expected}</div>
                </button>
              ))
            }
          </div>
        </section>
      </aside>

      {/* ── Main Canvas ──────────────────────────────────────────────────── */}
      <main className={s.main}>

        {polling && (
          <div className={s.poll}>
            <span className={s.spinner} />
            <span>{pollText || 'Polling status…'}</span>
          </div>
        )}

        {/* Hero metrics */}
        <div className={s.heroRow}>
          {([
            ['Status',    result ? <span className={`${s.badge} ${s[(result.status ?? '') as keyof typeof s] ?? ''}`}>{result.status ?? '-'}</span> : '-'],
            ['Coverage',  result?.coverage_percent != null ? `${Number(result.coverage_percent).toFixed(0)}%` : '-'],
            ['Markdowns', result ? (result.summary?.total_markdowns ?? (result.markdown ? 1 : 0)) : '-'],
            ['Audio',     result ? (result.summary?.total_audio_files ?? 0) : '-'],
            ['Elapsed',   result?.elapsed_seconds != null ? `${Number(result.elapsed_seconds).toFixed(1)}s` : '-'],
          ] as [string, React.ReactNode][]).map(([label, value]) => (
            <div key={label} className={s.metric}>
              <span className={s.metricLabel}>{label}</span>
              <strong className={s.metricValue}>{value}</strong>
            </div>
          ))}
        </div>

        {/* Run output panel */}
        <div className={s.panel}>
          <div className={s.panelHead}>
            <strong>Run output</strong>
            <div className={s.tabs}>
              {(['visual', 'markdown', 'json'] as OutputTab[]).map(t => (
                <button key={t} className={`${s.tab} ${outputTab === t ? s.tabActive : ''}`} onClick={() => setOutputTab(t)}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className={s.panelBody}>
            {outputTab === 'visual' && (
              markdownItems.length
                ? markdownItems.map((item, i) => (
                  <div key={i} className={`${s.panel} ${s.markdownSection}`}>
                    <div className={s.panelHead}><strong>{i + 1}. {item.title}</strong></div>
                    <div className={s.panelBody}>
                      <pre className={s.rawMarkdown}>{item.content}</pre>
                    </div>
                  </div>
                ))
                : <div className={s.empty}>Upload a ZIP or click a generated test case to see raw markdown output.</div>
            )}

            {outputTab === 'markdown' && (
              markdownItems.length
                ? markdownItems.map((item, i) => (
                  <div key={i} className={`${s.panel} ${s.markdownSection}`}>
                    <div className={s.panelHead}><strong>{i + 1}. {item.title}</strong></div>
                    <div className={`${s.panelBody} ${s.markdown}`}>
                      <MarkdownPreview content={item.content} />
                    </div>
                  </div>
                ))
                : <div className={s.empty}>No markdown preview yet.</div>
            )}

            {outputTab === 'json' && (
              <pre className={s.mono} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, fontSize: 12, lineHeight: 1.55 }}>
                {result ? JSON.stringify(result, null, 2) : '{}'}
              </pre>
            )}
          </div>
        </div>

        {/* Snapshot history */}
        <div className={s.panel}>
          <div className={s.panelHead}>
            <strong>Snapshot history</strong>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select className={s.select} style={{ width: 'auto' }} value={histFilter} onChange={e => setHistFilter(e.target.value)}>
                <option value="all">All</option>
                <option value="valid">Valid</option>
                <option value="edge">Edge</option>
                <option value="break">Break</option>
                <option value="complete">Complete</option>
                <option value="error">Error</option>
              </select>
              <button className={`${s.btn} ${s.btnDanger}`} onClick={clearAllHistory}>Clear all</button>
            </div>
          </div>
          {filteredSnaps.length === 0
            ? <div className={s.empty}>No snapshots yet.</div>
            : (
              <div className={s.tableWrap}>
                <table className={s.table}>
                  <thead>
                    <tr>
                      {['File', 'Job', 'Type', 'Status', 'Coverage', 'Uploaded', ''].map(h => (
                        <th key={h} className={s.th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSnaps.map(snap => {
                      const sr = snap.status_response as ScrapeResult | null | undefined;
                      const cov = sr?.coverage_percent != null ? `${Number(sr.coverage_percent).toFixed(0)}%` : '-';
                      return (
                        <tr key={snap.id} className={s.trHover} style={{ cursor: 'pointer' }} onClick={() => selectSnapshot(snap)}>
                          <td className={`${s.td} ${s.tdFile}`} title={snap.filename}>{snap.filename}</td>
                          <td className={`${s.td} ${s.mono}`}>{(snap.job_id || '-').slice(0, 12)}</td>
                          <td className={s.td}><span className={`${s.badge} ${s[(snap.test_category || 'valid') as keyof typeof s] ?? ''}`}>{snap.test_category || 'valid'}</span></td>
                          <td className={s.td}><span className={`${s.badge} ${s[(snap.status || 'uploaded') as keyof typeof s] ?? ''}`}>{snap.status || 'uploaded'}</span></td>
                          <td className={s.td}>{cov}</td>
                          <td className={s.td}>{new Date(snap.uploaded_at).toLocaleString()}</td>
                          <td className={s.td}>
                            <button className={`${s.btn} ${s.btnIcon} ${s.btnDanger}`} onClick={e => deleteSnapshot(snap.id, e)}>✕</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          }
        </div>
      </main>

      {/* ── Right Preview Pane ───────────────────────────────────────────── */}
      <aside className={s.preview}>
        <section className={s.section}>
          <div className={s.eyebrow}>Selected snapshot</div>
          <h2 className={s.title}>{selected ? selected.filename : 'Nothing selected'}</h2>
          <p className={s.hint}>
            {selected?.notes || 'Every upload is recorded in local db.json with filename, job id, upload response, final status response, and notes.'}
          </p>
        </section>

        <section className={s.section}>
          <div className={s.eyebrow}>Run details</div>
          <div className={s.infoGrid} style={{ marginTop: 10 }}>
            <KV label="Snapshot"  value={selected?.id?.slice(0, 8) ?? '-'} />
            <KV label="File"      value={selected?.filename ?? '-'} />
            <KV label="Job"       value={selected?.job_id ?? '-'} />
            <KV label="Category"  value={selected?.test_category ?? '-'} />
            <KV label="Uploaded"  value={selected ? new Date(selected.uploaded_at).toLocaleString() : '-'} />
            <KV label="Generator" value={selected?.generator_type ?? '-'} />
          </div>
        </section>

        <section className={s.section}>
          <div className={s.eyebrow}>Break ideas covered</div>
          <p className={s.hint}>
            XSS in manifest fields, XXE entity injection (file read + SSRF), ZIP Slip path traversal,
            XSS DOM vectors (10 payloads), XML Billion Laughs DoS, CSS exfiltration via url(),
            overlong strings (buffer overflow), null byte injection, path traversal + SSRF hrefs,
            Unicode BiDi override + homograph attacks.
          </p>
        </section>
      </aside>

    </div>
  );
}

// ── Helper components ─────────────────────────────────────────────────────────

function KV({ label, value }: { label: string; value: string }) {
  const s2 = { kv: 'kv', kvLabel: 'kvLabel', kvValue: 'kvValue' };
  return (
    <div style={{ border: '1px solid #edf1f6', borderRadius: 7, padding: 9, background: '#fff', minWidth: 0 }}>
      <label style={{ display: 'block', color: '#667085', fontSize: 11, marginBottom: 4 }}>{label}</label>
      <div style={{ wordBreak: 'break-word', fontFamily: '"Cascadia Code","SFMono-Regular",Consolas,monospace', fontSize: 12 }}>{value}</div>
    </div>
  );
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function MarkdownPreview({ content }: { content: string }) {
  return <>{renderMarkdownBlocks(content)}</>;
}

function renderMarkdownBlocks(content: string) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let code: string[] | null = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(<p key={`p-${blocks.length}`}>{renderInline(paragraph.join(' '))}</p>);
    paragraph = [];
  };

  const flushList = () => {
    if (!list) return;
    const Tag = list.ordered ? 'ol' : 'ul';
    blocks.push(
      <Tag key={`list-${blocks.length}`}>
        {list.items.map((item, i) => <li key={i}>{renderInline(item)}</li>)}
      </Tag>,
    );
    list = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '');
    const fence = line.match(/^```(?:\w+)?\s*$/);

    if (code) {
      if (fence) {
        blocks.push(
          <pre key={`code-${blocks.length}`} className={s.markdownCode}>
            <code>{code.join('\n')}</code>
          </pre>,
        );
        code = null;
      } else {
        code.push(rawLine);
      }
      continue;
    }

    if (fence) {
      flushParagraph();
      flushList();
      code = [];
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const Tag = `h${heading[1].length}` as keyof JSX.IntrinsicElements;
      blocks.push(<Tag key={`h-${blocks.length}`}>{renderInline(heading[2])}</Tag>);
      continue;
    }

    const ordered = line.match(/^\s*\d+\.\s+(.+)$/);
    const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
    if (ordered || unordered) {
      flushParagraph();
      const isOrdered = Boolean(ordered);
      if (!list || list.ordered !== isOrdered) flushList();
      if (!list) list = { ordered: isOrdered, items: [] };
      list.items.push((ordered ?? unordered)![1]);
      continue;
    }

    const quote = line.match(/^>\s?(.+)$/);
    if (quote) {
      flushParagraph();
      flushList();
      blocks.push(<blockquote key={`quote-${blocks.length}`}>{renderInline(quote[1])}</blockquote>);
      continue;
    }

    paragraph.push(line.trim());
  }

  if (code) {
    blocks.push(
      <pre key={`code-${blocks.length}`} className={s.markdownCode}>
        <code>{code.join('\n')}</code>
      </pre>,
    );
  }
  flushParagraph();
  flushList();

  return blocks.length ? blocks : <p>{content}</p>;
}

function renderInline(text: string) {
  const parts: React.ReactNode[] = [];
  const token = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = token.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));

    const value = match[0];
    if (value.startsWith('`')) {
      parts.push(<code key={parts.length}>{value.slice(1, -1)}</code>);
    } else if (value.startsWith('[')) {
      const link = value.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      const href = link?.[2] ?? '#';
      parts.push(<a key={parts.length} href={href} target="_blank" rel="noreferrer">{link?.[1] ?? value}</a>);
    } else {
      parts.push(<strong key={parts.length}>{value.slice(2, -2)}</strong>);
    }

    lastIndex = token.lastIndex;
  }

  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
}
