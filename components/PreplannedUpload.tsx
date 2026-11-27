'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Row {
  line: number;
  summary: string;
  errors: string[];
  warnings: string[];
  duplicate: boolean;
}

/** Upload a .csv/.xlsx of pre-planned streams: check it first, then add to or replace the month's list. */
export default function PreplannedUpload({ monthId, existingCount, open }: { monthId: number; existingCount: number; open?: boolean }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [other, setOther] = useState<{ count: number; month: string } | null>(null);
  const [mode, setMode] = useState<'add' | 'replace'>(existingCount ? 'add' : 'replace');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function send(m: 'preview' | 'add' | 'replace') {
    if (!file) return;
    setBusy(true); setError(null); setDone(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('mode', m);
      const res = await fetch(`/api/months/${monthId}/preplanned-upload`, { method: 'POST', body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Upload failed');
      if (m === 'preview') { setRows(body.rows); setOther({ count: body.otherMonths || 0, month: body.month }); }
      else {
        setDone(`Imported ${body.added} pre-planned stream${body.added === 1 ? '' : 's'}` +
          (body.removed ? `, replacing ${body.removed}` : '') +
          (body.skipped ? `. Skipped ${body.skipped} row${body.skipped === 1 ? '' : 's'} with problems` : '') +
          (body.duplicates ? `. ${body.duplicates} already existed` : '') + '.');
        setRows(null); setFile(null);
        router.refresh();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const ok = rows?.filter(r => !r.errors.length && !r.duplicate) ?? [];
  const bad = rows?.filter(r => r.errors.length) ?? [];
  const dup = rows?.filter(r => !r.errors.length && r.duplicate) ?? [];
  const warn = ok.filter(r => r.warnings.length);

  return (
    <details className="card upload-card" open={open || undefined} data-tour="preplanned-upload">
      <summary><strong>Upload pre-planned streams from a file</strong> <span className="small muted">(.csv or Excel .xlsx)</span></summary>
      <p className="small muted" style={{ marginTop: 8 }}>
        Columns (any order): <strong>date, start time, end time, brand, platform</strong>, plus optional talent/host (blank = auto-assign), period (BAU/Mega), sale and room,
        the same as the sheet&rsquo;s Pre_Planned_Streams tab. Times can be 20:00 or 8pm, or one &ldquo;time&rdquo; column like 8pm&ndash;10pm.{' '}
        <a href={`/api/months/${monthId}/preplanned-template`}>Download a template</a>.
      </p>
      <div className="inline" style={{ flexWrap: 'wrap' }}>
        <input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={e => { setFile(e.target.files?.[0] ?? null); setRows(null); setDone(null); setError(null); }} />
        <button type="button" onClick={() => send('preview')} disabled={!file || busy}>{busy && !rows ? 'Checking…' : 'Check file'}</button>
      </div>
      {error && <div className="notice bad" style={{ marginTop: 10 }}>{error}</div>}
      {done && <div className="notice ok" style={{ marginTop: 10 }}>{done}</div>}
      {rows && (
        <div style={{ marginTop: 12 }}>
          <p style={{ margin: '0 0 8px' }}>
            <span className="badge ok">{ok.length} ready</span>{' '}
            {warn.length > 0 && <span className="badge warn">{warn.length} with warnings</span>}{' '}
            {dup.length > 0 && <span className="badge">{dup.length} already on the list</span>}{' '}
            {bad.length > 0 && <span className="badge bad">{bad.length} will be skipped</span>}{' '}
            {other && other.count > 0 && <span className="small muted">Only rows in {other.month} are read; {other.count} rows from other months were ignored.</span>}
          </p>
          <div className="table-wrap" style={{ maxHeight: 320, overflow: 'auto' }}>
            <table className="compact">
              <thead><tr><th>Row</th><th>Stream</th><th>Check</th></tr></thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.line} className={r.errors.length ? 'up-bad' : r.duplicate ? 'up-dup' : r.warnings.length ? 'up-warn' : ''}>
                    <td className="nw">{r.line}</td>
                    <td className="nw">{r.summary}</td>
                    <td>
                      {r.errors.length ? <span className="badge bad">Skip</span> : r.duplicate ? <span className="badge">Already on the list</span> : <span className="badge ok">OK</span>}{' '}
                      <span className="small">{[...r.errors, ...r.warnings].join('; ')}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="inline" style={{ flexWrap: 'wrap', marginTop: 10, gap: 16 }}>
            <label className="inline"><input type="radio" name="up-mode" checked={mode === 'add'} onChange={() => setMode('add')} /> Add to the existing list{existingCount ? ` (${existingCount})` : ''}</label>
            <label className="inline"><input type="radio" name="up-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} /> Replace this month&rsquo;s pre-planned streams{existingCount ? ` (removes ${existingCount})` : ''}</label>
            <button type="button" className="primary" disabled={busy || !ok.length}
              onClick={() => { if (mode === 'add' || confirm(`Remove the ${existingCount} existing pre-planned streams and import ${ok.length + dup.length} from the file?`)) send(mode); }}>
              {busy ? 'Importing…' : `Import ${mode === 'replace' ? ok.length + dup.length : ok.length} stream${(mode === 'replace' ? ok.length + dup.length : ok.length) === 1 ? '' : 's'}`}
            </button>
          </div>
          <p className="small muted" style={{ marginBottom: 0 }}>Imported streams are used the next time you run the scheduler; existing schedule versions don&rsquo;t change.</p>
        </div>
      )}
    </details>
  );
}
