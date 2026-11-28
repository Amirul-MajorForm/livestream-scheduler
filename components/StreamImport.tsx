'use client';

import { useState } from 'react';
import { money } from '@/lib/earnings';

interface MonthSummary {
  month: number; label: string; streams: number; withSales: number; gmv: number; fees: number;
  published: { label: string; streams: number } | null;
}
interface Preview {
  sheet: string; months: MonthSummary[]; cancelled: number;
  problems: { row: number; reason: string }[]; unknownHosts: string[]; unknownBrands: string[];
}
interface Done { label: string; streams: number; sales: number; runId: number; monthId: number }

/** Upload the Revenue / Master sheet, check what's in it month by month, then import the ticked months. */
export default function StreamImport() {
  const [file, setFile] = useState<File | null>(null);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [busy, setBusy] = useState<'' | 'preview' | 'import'>('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [done, setDone] = useState<Done[] | null>(null);

  async function send(mode: 'preview' | 'import') {
    if (!file) { setError('Choose the .xlsx file first'); return; }
    setBusy(mode); setError('');
    const fd = new FormData();
    fd.set('file', file); fd.set('year', year); fd.set('mode', mode);
    if (mode === 'import') fd.set('months', [...picked].join(','));
    try {
      const res = await fetch('/api/import-streams', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({ error: 'The server didn’t answer properly. Try again.' }));
      if (!res.ok || data.error) { setError(data.error || 'Import failed'); return; }
      if (mode === 'preview') {
        setPreview(data); setDone(null);
        setPicked(new Set((data as Preview).months.filter(m => !m.published).map(m => m.month)));
      } else setDone(data.imported);
    } catch {
      setError('Couldn’t reach the server. Check your connection and try again.');
    } finally { setBusy(''); }
  }
  const toggle = (m: number) => setPicked(p => { const n = new Set(p); if (n.has(m)) n.delete(m); else n.add(m); return n; });
  const chosen = preview?.months.filter(m => picked.has(m.month)) || [];

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>Import a year of streams and sales</h2>
      <p className="small muted">
        From the <strong>Revenue Sheet</strong> (Internal Agency &amp; Total Fees tab) or the <strong>Master Availability Sheet</strong> (NEW Availability 2026 tab, or Availability 2025 for last year; set the year below):
        download it as .xlsx and upload it here. Each month you tick gets a new schedule version, <em>Imported from sheet</em>, which is published so hosts see their streams,
        and its GMV, payment status, rate version, tier and talent fee go into <em>Sales &amp; earnings</em>. Cancelled rows are left out.
        Earlier versions of a month are kept, so you can switch back by publishing one of them. Importing a month again replaces the sales that came from the sheet; streams that haven&rsquo;t happened yet come in without sales.
      </p>
      <div className="form-row">
        <label className="field">File<input type="file" accept=".xlsx" onChange={e => { setFile(e.target.files?.[0] || null); setPreview(null); setDone(null); }} /></label>
        <label className="field" style={{ flex: '0 0 110px' }}>Year<input inputMode="numeric" value={year} onChange={e => setYear(e.target.value)} /></label>
        <div style={{ flex: '0 0 auto' }}><button type="button" className="primary" disabled={!file || !!busy} onClick={() => send('preview')}>{busy === 'preview' ? 'Reading…' : 'Check file'}</button></div>
      </div>
      {error && <div className="notice bad slim" style={{ marginTop: 12 }}>{error}</div>}

      {preview && !done && (
        <div style={{ marginTop: 14 }}>
          <p className="small" style={{ marginTop: 0 }}>
            Read the <strong>{preview.sheet}</strong> tab: {preview.months.reduce((a, m) => a + m.streams, 0)} streams in {preview.months.length} months
            {preview.cancelled ? `, ${preview.cancelled} cancelled rows left out` : ''}.
          </p>
          <div className="table-wrap">
            <table className="compact">
              <thead>
                <tr><th className="cb"></th><th>Month</th><th className="num">Streams</th><th className="num">With sales</th><th className="num">GMV</th><th className="num" data-tip="Talent fees as the sheet shows them. Streams that haven't happened yet are imported without sales, so their base-only fees aren't brought in.">Fees in sheet</th><th>In the app now</th></tr>
              </thead>
              <tbody>
                {preview.months.map(m => (
                  <tr key={m.month}>
                    <td className="cb"><input type="checkbox" checked={picked.has(m.month)} onChange={() => toggle(m.month)} aria-label={'Import ' + m.label} /></td>
                    <td><strong>{m.label}</strong></td>
                    <td className="num">{m.streams}</td><td className="num">{m.withSales}</td>
                    <td className="num">{money(m.gmv)}</td><td className="num">{money(m.fees)}</td>
                    <td>{m.published
                      ? <span className="badge warn" data-tip={`This month already has a published schedule (${m.published.label}, ${m.published.streams} streams). Importing publishes the sheet's streams instead; the current version is kept and can be re-published.`}>Published: {m.published.label} ({m.published.streams})</span>
                      : <span className="small muted">Nothing published</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(preview.unknownHosts.length > 0 || preview.unknownBrands.length > 0) && (
            <div className="notice info slim">
              {preview.unknownHosts.length > 0 && <div><strong>Hosts not in the app</strong> (kept as written, not linked to a host login): {preview.unknownHosts.map(h => '\u201c' + h + '\u201d').join(', ')}. Rows with two hosts stay as one stream.</div>}
              {preview.unknownBrands.length > 0 && <div><strong>Brands not in the app</strong> (kept as written): {preview.unknownBrands.join(', ')}.</div>}
            </div>
          )}
          {preview.problems.length > 0 && (
            <details className="small" style={{ marginBottom: 10 }}>
              <summary>{preview.problems.length} row{preview.problems.length === 1 ? '' : 's'} can&rsquo;t be imported</summary>
              <ul>{preview.problems.slice(0, 50).map(p => <li key={p.row}>Row {p.row}: {p.reason}</li>)}</ul>
            </details>
          )}
          <div className="row-actions">
            <button type="button" className="primary" disabled={!chosen.length || !!busy}
              onClick={() => {
                const replacing = chosen.filter(m => m.published);
                if (replacing.length && !confirm(`${replacing.map(m => m.label).join(', ')} already ${replacing.length === 1 ? 'has' : 'have'} a published schedule. Publish the sheet's streams instead? (The current versions are kept.)`)) return;
                send('import');
              }}>
              {busy === 'import' ? 'Importing…' : `Import ${chosen.length} month${chosen.length === 1 ? '' : 's'} (${chosen.reduce((a, m) => a + m.streams, 0)} streams)`}
            </button>
            <span className="small muted">Months already published in the app are unticked; tick them to replace.</span>
          </div>
        </div>
      )}

      {done && (
        <div className="notice ok" style={{ marginTop: 14 }}>
          <strong>Imported.</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {done.map(d => (
              <li key={d.monthId}>{d.label}: {d.streams} streams, {d.sales} with sales.{' '}
                <a href={`/admin/months/${d.monthId}?tab=sales`}>Sales &amp; earnings</a> &middot; <a href={`/admin/runs/${d.runId}`}>Schedule</a></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
