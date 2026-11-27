import Link from 'next/link';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { query } from '@/lib/db';
import { getRules, getSetting } from '@/lib/settings';
import { ORIGINAL_RULES } from '@/lib/scheduler';
import { fmtDateTime } from '@/lib/format';
import Flash from '@/components/Flash';
import ConfirmButton from '@/components/ConfirmButton';
import { saveRulesAction, addBrandPair, removeBrandPair, savePlannerNotes } from '../actions';

const FRIDAY = { avoid: 'Avoid (only if nothing better)', never: 'Never on Fridays', allow: 'No preference' } as const;
const LATE = {
  'avoid-alone': 'Avoid: alone in a slot from 6PM',
  never: 'Never 10PM–12MN',
  allow: 'No preference',
} as const;

export default async function RulesPage({ searchParams }: { searchParams: Promise<{ ok?: string; bad?: string }> }) {
  const sp = await searchParams;
  const [rules, notes, brands, rooms, saved] = await Promise.all([
    getRules(),
    getSetting<string>('planner_notes', ''),
    query('SELECT name FROM brands ORDER BY name'),
    query('SELECT name, status FROM rooms ORDER BY sort_order, id'),
    getSetting('planning_rules', null),
  ]);
  let script = '';
  try { script = readFileSync(join(process.cwd(), 'docs', 'apps-script-v7.js'), 'utf8'); } catch { /* not deployed */ }
  const usable = rooms.filter(r => r.status !== 'unavailable');
  const orig = (v: string) => <span className="small muted"> Original script: {v}.</span>;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Planning rules</h1>
          <p className="muted">
            The rules the scheduler follows. Change the adjustable ones below; they apply the next time you run the scheduler (existing versions don&rsquo;t change).
            Host caps and brands are on <Link href="/admin/hosts">Hosts</Link>; sale days and daytime limits are per month; rooms are on <Link href="/admin/settings">Brands, rooms &amp; team</Link>.
          </p>
        </div>
      </div>
      <Flash sp={sp} />

      <div className="grid2">
        <form action={saveRulesAction} className="card rules-form">
          <h2 style={{ marginTop: 0 }}>Adjustable rules</h2>
          <label className="rule">
            <span><strong>Same brand, same time, different platforms</strong><br />
              <span className="small muted">e.g. Blackmores on TikTok and Blackmores on Shopee at 8PM. &ldquo;TikTok &amp; Shopee&rdquo; streams use both platforms, so they still clash.</span>
              {orig('not allowed')}</span>
            <select name="sameBrandDifferentPlatformOk" defaultValue={rules.sameBrandDifferentPlatformOk ? 'yes' : 'no'}>
              <option value="yes">Allowed</option><option value="no">Not allowed</option>
            </select>
          </label>
          <label className="rule">
            <span><strong>Most streams per host per day</strong>{orig(String(ORIGINAL_RULES.maxStreamsPerHostPerDay))}</span>
            <input name="maxStreamsPerHostPerDay" type="number" min={1} max={6} defaultValue={rules.maxStreamsPerHostPerDay} style={{ width: 70 }} />
          </label>
          <label className="rule">
            <span><strong>BAU streams on Fridays</strong><br /><span className="small muted">Your notes list Friday as a blackout day.</span>{orig('avoid')}</span>
            <select name="fridayBau" defaultValue={rules.fridayBau}>
              {Object.entries(FRIDAY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="rule">
            <span><strong>Female hosts in late slots</strong><br /><span className="small muted">Your notes say no 10PM&ndash;12MN streams for female hosts at the studio.</span>{orig('avoid being the only stream from 6PM')}</span>
            <select name="lateFemale" defaultValue={rules.lateFemale}>
              {Object.entries(LATE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <div className="inline" style={{ justifyContent: 'space-between', width: '100%' }}>
            <span className="small muted">
              {saved.updatedAt ? <>Last changed {fmtDateTime(saved.updatedAt)}{saved.updatedBy ? ' by ' + saved.updatedBy : ''}.</> : 'Using the default rules.'}
            </span>
            <button type="submit" className="primary">Save rules</button>
          </div>
        </form>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Brands that can&rsquo;t stream at the same time</h2>
          <p className="small muted">For space or product clashes, e.g. your note &ldquo;Blackmores + TO cannot be conducted at the same time&rdquo;. The scheduler won&rsquo;t overlap these, and the schedule flags any that do (e.g. from pre-planned bookings).</p>
          <table className="compact">
            <tbody>
              {rules.brandsApart.map(([a, b], i) => (
                <tr key={i}>
                  <td><strong>{a}</strong> &harr; <strong>{b}</strong></td>
                  <td style={{ textAlign: 'right' }}>
                    <form action={removeBrandPair}><input type="hidden" name="index" value={i} />
                      <ConfirmButton className="link danger" message={`Allow ${a} and ${b} at the same time again?`}>Remove</ConfirmButton></form>
                  </td>
                </tr>
              ))}
              {!rules.brandsApart.length && <tr><td className="muted">None yet.</td></tr>}
            </tbody>
          </table>
          <form action={addBrandPair} className="inline" style={{ marginTop: 10, flexWrap: 'wrap' }}>
            <select name="a" required defaultValue=""><option value="" disabled>Brand</option>{brands.map(b => <option key={b.name}>{b.name}</option>)}</select>
            <span>and</span>
            <select name="b" required defaultValue=""><option value="" disabled>Brand</option>{brands.map(b => <option key={b.name}>{b.name}</option>)}</select>
            <button type="submit">Keep apart</button>
          </form>
        </div>
      </div>

      <div className="card rules-doc">
        <h2 style={{ marginTop: 0 }}>How the scheduler plans a month</h2>
        <p className="small muted">This reflects the current settings. The logic comes from the original Apps Script (V7); the app reproduces it row for row when the rules are set to the original values.</p>
        <h3>1. Fixed bookings go in first</h3>
        <ul>
          <li>Confirmed streams from the published version, then the month&rsquo;s pre-planned streams, are locked in exactly as entered, even if they break a rule below (the schedule flags it).</li>
          <li>Pre-planned streams without a host get the best eligible, available host who still has room under their caps. If nobody qualifies they stay &ldquo;No host&rdquo; and still hold a room.</li>
          <li>Each locked stream counts toward a matching commitment (same brand, BAU/Mega, platform and sale); extras are kept but don&rsquo;t count.</li>
        </ul>
        <h3>2. Hard rules (never broken by the scheduler)</h3>
        <ul>
          <li><strong>Brand:</strong> the host has the brand as Preferred or Regular. Excluded or blank means never.</li>
          <li><strong>Platform:</strong> the host is set up for the stream&rsquo;s platform; &ldquo;TikTok &amp; Shopee&rdquo; is one stream on both, so the host needs both.</li>
          <li><strong>Availability:</strong> the host ticked both hours of the 2-hour block.</li>
          <li><strong>Caps:</strong> the host&rsquo;s monthly maximum, their maximum share of any one brand&rsquo;s sessions (max % per brand), and at most <strong>{rules.maxStreamsPerHostPerDay}</strong> stream{rules.maxStreamsPerHostPerDay === 1 ? '' : 's'} a day.</li>
          <li><strong>No double-booking:</strong> a host and a room each do one stream at a time.</li>
          <li><strong>Brand clashes:</strong> {rules.sameBrandDifferentPlatformOk
            ? 'the same brand can’t stream twice at the same time on the same platform (different platforms are fine)'
            : 'the same brand can’t stream twice at the same time, on any platform'}{rules.brandsApart.length ? <>; and {rules.brandsApart.map(([a, b]) => `${a} with ${b}`).join(', ')} never overlap</> : ''}.</li>
          <li><strong>Rooms:</strong> one stream per room at a time. Rooms in use: {usable.map(r => r.name + (r.status === 'last resort' ? ' (last resort)' : '')).join(', ')}, so up to {usable.length} streams at once. Hosts limited to certain rooms (set on their page) only use those.</li>
          {rules.fridayBau === 'never' && <li><strong>Fridays:</strong> no BAU streams.</li>}
          {rules.lateFemale === 'never' && <li><strong>Late slots:</strong> no female hosts 10PM&ndash;12MN.</li>}
          <li><strong>Days:</strong> BAU commitments only on BAU days; Mega commitments only on the sale days they list (from the month&rsquo;s sale days).</li>
        </ul>
        <h3>3. Order of work</h3>
        <ul>
          <li>Commitments with the fewest possible host/time options go first; Mega before BAU on ties, then by priority (1 = highest).</li>
          <li>Up to 16 passes with different tie-breaks, plus a repair step that moves one stream to make room for a stuck commitment. The pass that fills the most commitments wins; among equals, the one that best follows the preferences below.</li>
        </ul>
        <h3>4. Preferences (soft: followed when possible)</h3>
        <ul>
          <li>Preferred hosts over Regular ones; spread work across hosts and spread each host across brands.</li>
          <li>One stream per host per day; if two, back-to-back rather than with a gap; avoid giving the same host many double days.</li>
          <li>Spread each commitment across the month: avoid the same week and neighbouring days.</li>
          <li>Time of day: 8PM&ndash;10PM is favoured most, then 6PM&ndash;8PM, 12PM&ndash;2PM, 4PM&ndash;6PM, 2PM&ndash;4PM, 10AM&ndash;12PM; 10PM&ndash;12MN least.</li>
          <li>Daytime limits per month (Rules &amp; sale days tab): once a commitment has used its weekday/weekend daytime share (before 8PM), later sessions lean to evenings.</li>
          <li>&ldquo;Last resort&rdquo; rooms only when others are taken; quieter days preferred over busy ones.</li>
          {rules.fridayBau === 'avoid' && <li>Avoid BAU streams on Fridays.</li>}
          {rules.lateFemale === 'avoid-alone' && <li>Avoid a female host being the only stream in a slot from 6PM.</li>}
        </ul>
        <h3>Not built in yet (from your notes)</h3>
        <ul className="muted">
          <li>Hosts who shouldn&rsquo;t do double-digit sale days two months running.</li>
          <li>Host-pair rules such as &ldquo;if Zul and Ler stream together, nothing else at the same time&rdquo;.</li>
          <li>Per-host brand limits like &ldquo;Clarice: no Oatside twice in one week&rdquo;.</li>
          <li>Off-site streams that block the host but not a studio room.</li>
        </ul>
        <p className="small muted" style={{ marginBottom: 0 }}>Add requests like these to the notes below so they can be built into the scheduler.</p>
      </div>

      <form action={savePlannerNotes} className="card">
        <h2 style={{ marginTop: 0 }}>Planner notes &amp; rule changes</h2>
        <p className="small muted">
          Planning imperatives for the team, and any rule you want added or changed. Whoever maintains the app (including Claude) reads these when updating the scheduler.
          {notes.updatedAt && <> Last edited {fmtDateTime(notes.updatedAt)}{notes.updatedBy ? ' by ' + notes.updatedBy : ''}.</>}
        </p>
        <textarea name="notes" rows={10} defaultValue={notes.value} style={{ width: '100%' }}
          placeholder={'e.g.\n- Schedule the next month at least 2 weeks ahead (by the 15th).\n- Blackmores + The Ordinary cannot be at the same time.\n- A host should not do double-digit days two months in a row.'} />
        <div style={{ marginTop: 8 }}><button type="submit" className="primary">Save notes</button></div>
      </form>

      <details className="card">
        <summary><strong>Original Apps Script (V7), for reference</strong> <span className="small muted">read-only: the scheduling logic the app was built from</span></summary>
        {script
          ? <pre className="code">{script}</pre>
          : <p className="muted">The script file isn&rsquo;t available on this server (docs/apps-script-v7.js in the repository).</p>}
      </details>
    </>
  );
}
