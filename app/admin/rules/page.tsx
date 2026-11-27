import Link from 'next/link';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { query } from '@/lib/db';
import { getRules, getSetting } from '@/lib/settings';
import { ORIGINAL_RULES } from '@/lib/scheduler';
import { fmtDateTime } from '@/lib/format';
import Flash from '@/components/Flash';
import ConfirmButton from '@/components/ConfirmButton';
import { saveRulesAction, addBrandPair, removeBrandPair, savePlannerNotes, savePlanningDoc } from '../actions';
import PlanningDoc from '@/components/PlanningDoc';
import { generatePlanningDoc } from '@/lib/planningDoc';

const FRIDAY = { avoid: 'Avoid (only if nothing better)', never: 'Never on Fridays', allow: 'No preference' } as const;
const LATE = {
  'avoid-alone': 'Avoid: alone in a slot from 6PM',
  never: 'Never 10PM–12MN',
  allow: 'No preference',
} as const;

export default async function RulesPage({ searchParams }: { searchParams: Promise<{ ok?: string; bad?: string }> }) {
  const sp = await searchParams;
  const [rules, notes, brands, rooms, saved, doc] = await Promise.all([
    getRules(),
    getSetting<string>('planner_notes', ''),
    query('SELECT name FROM brands ORDER BY name'),
    query('SELECT name, status FROM rooms ORDER BY sort_order, id'),
    getSetting('planning_rules', null),
    getSetting<string | null>('planning_doc', null),
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

      <PlanningDoc
        text={doc.value ?? generatePlanningDoc(rules, rooms as { name: string; status: string }[])}
        custom={doc.value != null}
        editedNote={doc.updatedAt ? fmtDateTime(doc.updatedAt) + (doc.updatedBy ? ' by ' + doc.updatedBy : '') : null}
        action={savePlanningDoc} />

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
