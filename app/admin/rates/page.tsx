import Link from 'next/link';
import { query } from '@/lib/db';
import { loadRates } from '@/lib/rates';
import Flash from '@/components/Flash';
import FeeCalculator from '@/components/FeeCalculator';
import RatesTable from '@/components/RatesTable';
import { loadBrandColors } from '@/lib/brandPalette';
import { addRate, updateRate, duplicateRate, removeRate, importRates } from '../actions';

const PERIODS = ['BAU', 'Mega', 'All'];
const TYPES: [string, string][] = [['any', 'Any'], ['single', 'One'], ['dual', 'Both']];

export default async function RatesPage({ searchParams }: { searchParams: Promise<{ brand?: string; view?: string; ok?: string; bad?: string; t?: string }> }) {
  const sp = await searchParams;
  const [rates, brandRows] = await Promise.all([loadRates(), query('SELECT name FROM brands ORDER BY name')]);
  const brands = [...new Set([...brandRows.map(b => b.name as string), ...rates.map(r => r.brand)])].sort((a, b) => a.localeCompare(b));
  const colors = await loadBrandColors(rates.map(r => r.brand));
  // Filters and sort carried through a save (see RatesTable); ?brand= still works as a starting filter.
  let view: { f?: Record<string, string>; s?: { i: number; dir: 1 | -1 } } = {};
  try { view = sp.view ? JSON.parse(sp.view) : {}; } catch { /* ignore a mangled link */ }
  if (sp.brand && !view.f) view.f = { brand: sp.brand };
  const returnTo = '/admin/rates' + (sp.brand ? '?brand=' + encodeURIComponent(sp.brand) : '');
  const missing = brandRows.map(b => b.name as string).filter(b => !rates.some(r => r.active && r.brand.toLowerCase() === b.toLowerCase()));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Payment rates</h1>
          <p className="muted" style={{ margin: 0 }}>
            What each brand pays hosts. Sales entered on a month&rsquo;s <em>Sales &amp; earnings</em> tab are worked out with these.
            Changes apply straight away, to every month.
          </p>
        </div>
      </div>
      <Flash sp={sp} />

      <details className="card">
        <summary><strong>How a fee is worked out</strong></summary>
        <ol className="small" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
          <li><strong>Pick the rate:</strong> same brand; period BAU or Mega (or a rate for <em>All</em>); platform: one platform, both (TikTok &amp; Shopee at once), or a rate for any; and the stream&rsquo;s date inside <em>valid from / to</em>. The most specific rate wins, then the newest.</li>
          <li><strong>GMV per hour</strong> = total GMV &divide; hours (&divide; hours &times; 2 for a both-platforms rate).</li>
          <li><strong>Tier</strong> (Dettol, Durex): the first tier whose &ldquo;to&rdquo; is at or above the GMV per hour. Leave the tier blank for brands without tiers.</li>
          <li><strong>Base + comms:</strong> (base per hour &times; hours + comms % &times; total GMV) &times; (1 &minus; agency %).<br />
            <strong>Split comms</strong> (e.g. OATSIDE): (TikTok % &times; TikTok GMV + Shopee % &times; Shopee GMV) &times; (1 &minus; agency %).</li>
        </ol>
        <p className="small muted" style={{ marginBottom: 0 }}>The same formulas as the Master Availability Sheet&rsquo;s Tier, GMV / Hour and Talent Fee columns.</p>
      </details>

      {rates.length > 0 && <FeeCalculator rates={rates} brands={brands} />}

      {missing.length > 0 && rates.length > 0 && (
        <div className="notice warn slim">No active rate yet for: {missing.join(', ')}. Their streams will show &ldquo;No rate&rdquo; until you add one.</div>
      )}

      {rates.length === 0 ? (
        <div className="card"><p style={{ margin: 0 }}>No rates yet. Import them from the Master Availability Sheet below, or add them one by one.</p></div>
      ) : (
        <RatesTable rates={rates} colors={colors} returnTo="/admin/rates" initialFilters={view.f} initialSort={view.s}
          update={updateRate} duplicate={duplicateRate} remove={removeRate} />
      )}

      <div className="grid2">
        <form action={addRate} className="card" key={'add' + (sp.t || '')}>
          <h2 style={{ marginTop: 0 }}>Add a rate</h2>
          <input type="hidden" name="returnTo" value={returnTo} />
          <div className="form-row">
            <label className="field">Brand<input name="brand" list="rate-brands" required defaultValue={sp.brand || ''} /></label>
            <label className="field">Version<input name="label" placeholder="e.g. 2027_Rates_V1" /></label>
            <label className="field">Account<select name="account"><option>Brand</option><option>Creator</option></select></label>
          </div>
          <div className="form-row" style={{ marginTop: 8 }}>
            <label className="field">Period<select name="period" defaultValue="All">{PERIODS.map(p => <option key={p}>{p}</option>)}</select></label>
            <label className="field">Platform<select name="stream_type" defaultValue="any">{TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label className="field">Method<select name="method"><option value="base_comms">Base + comms</option><option value="split">Split comms (per platform)</option></select></label>
            <label className="field">Tier<input name="tier" placeholder="blank = no tiers" /></label>
          </div>
          <div className="form-row" style={{ marginTop: 8 }}>
            <label className="field">GMV/h from<input name="gmv_min" inputMode="decimal" /></label>
            <label className="field">GMV/h to<input name="gmv_max" inputMode="decimal" /></label>
            <label className="field">Base $ / hour<input name="base_per_hour" inputMode="decimal" placeholder="0" /></label>
            <label className="field">Comms %<input name="total_comms" inputMode="decimal" placeholder="e.g. 10" /></label>
          </div>
          <div className="form-row" style={{ marginTop: 8 }}>
            <label className="field">TikTok % (split)<input name="tiktok_comms" inputMode="decimal" /></label>
            <label className="field">Shopee % (split)<input name="shopee_comms" inputMode="decimal" /></label>
            <label className="field">Agency %<input name="agency_comms" inputMode="decimal" defaultValue="20" /></label>
          </div>
          <div className="form-row" style={{ marginTop: 8 }}>
            <label className="field">Valid from<input type="date" name="valid_from" /></label>
            <label className="field">Valid to<input type="date" name="valid_to" /></label>
            <div><button className="primary" type="submit">Add rate</button></div>
          </div>
          <datalist id="rate-brands">{brands.map(b => <option key={b} value={b} />)}</datalist>
          <p className="small muted" style={{ marginBottom: 0 }}>Tip: to change a brand&rsquo;s rates from a date, use <em>Copy</em> on its current rows, give the copies the new version name, amounts and &ldquo;valid from&rdquo;, and set &ldquo;valid to&rdquo; on the old rows.</p>
        </form>

        <form action={importRates} className="card">
          <h2 style={{ marginTop: 0 }}>Import from the Master Availability Sheet</h2>
          <p className="small muted">
            In Google Sheets: <em>File &rarr; Download &rarr; Microsoft Excel (.xlsx)</em>, then upload it here. The app reads the <strong>Reference</strong> tab (the rates) and the <strong>Version</strong> tab (from when each version applies).
            Versions not listed in the Version tab (e.g. 2025 rates) come in switched off.
          </p>
          <input type="file" name="file" accept=".xlsx" required />
          <div className="form-row" style={{ marginTop: 10 }}>
            <label className="field">Existing rates
              <select name="mode" defaultValue="replace"><option value="replace">Replace all existing rates</option><option value="add">Keep them and add these</option></select>
            </label>
            <div><button className="primary" type="submit">Import rates</button></div>
          </div>
        </form>
      </div>
      <p className="small muted">Sales are entered per month: open a month from <Link href="/admin">Months</Link> and choose <em>Sales &amp; earnings</em>.</p>
    </>
  );
}
