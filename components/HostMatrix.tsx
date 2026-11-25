'use client';

import { useState } from 'react';
import Link from 'next/link';
import SortHeader from './SortHeader';

type Level = 'preferred' | 'regular' | 'excluded';

export interface MatrixHost {
  id: number;
  name: string;
  active: boolean;
  login: string | null;
  maxStreams: number | null;
  maxBrandPct: string;
  platforms: string;
  needsSetup: boolean;
}

const LEVEL_LABEL: Record<Level, string> = { preferred: 'P', regular: 'R', excluded: '–' };
const LEVEL_NAME: Record<Level, string> = { preferred: 'Preferred', regular: 'Regular', excluded: 'Excluded (never scheduled)' };

/**
 * Hosts grid with in-place editing: each brand cell and the Active column are dropdowns that save
 * immediately. Headers (and the host column) stay visible while scrolling.
 */
export default function HostMatrix({ hosts, brands, prefs, sort, dir }: {
  hosts: MatrixHost[];
  brands: { id: number; name: string }[];
  prefs: Record<string, Level>; // "hostId|brandId"
  sort: string;
  dir: 'asc' | 'desc';
}) {
  const [levels, setLevels] = useState(prefs);
  const [active, setActive] = useState<Record<number, boolean>>(() => Object.fromEntries(hosts.map(h => [h.id, h.active])));
  const [saving, setSaving] = useState<Record<string, 'saving' | 'saved' | 'error'>>({});
  const [error, setError] = useState<string | null>(null);

  async function patch(hostId: number, key: string, body: object, undo: () => void) {
    setSaving(s => ({ ...s, [key]: 'saving' }));
    setError(null);
    try {
      const res = await fetch(`/api/hosts/${hostId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || 'Could not save');
      setSaving(s => ({ ...s, [key]: 'saved' }));
      setTimeout(() => setSaving(s => { const n = { ...s }; if (n[key] === 'saved') delete n[key]; return n; }), 1200);
    } catch (e) {
      undo();
      setSaving(s => ({ ...s, [key]: 'error' }));
      setError((e as Error).message + '. The change was undone.');
    }
  }

  const setLevel = (hostId: number, brandId: number, level: Level) => {
    const key = hostId + '|' + brandId;
    const prev = levels[key] || 'excluded';
    setLevels(l => ({ ...l, [key]: level }));
    patch(hostId, key, { brandId, level }, () => setLevels(l => ({ ...l, [key]: prev })));
  };
  const setHostActive = (hostId: number, value: boolean) => {
    const prev = active[hostId];
    setActive(a => ({ ...a, [hostId]: value }));
    patch(hostId, 'active|' + hostId, { active: value }, () => setActive(a => ({ ...a, [hostId]: prev })));
  };

  return (
    <>
      {error && <div className="notice bad">{error}</div>}
      <div className="table-wrap sticky-matrix" data-tour="hosts-table">
        <table className="matrix hosts-matrix">
          <thead>
            <tr>
              <SortHeader label="Host" k="host" sort={sort} dir={dir} params={{}} className="sticky-col" />
              <SortHeader label="Status" k="status" sort={sort} dir={dir} params={{}} />
              <SortHeader label="Login" k="login" sort={sort} dir={dir} params={{}} />
              <SortHeader label="Max / month" k="max" sort={sort} dir={dir} params={{}} className="num" />
              <SortHeader label="Max % per brand" k="pct" sort={sort} dir={dir} params={{}} className="num" />
              <th>Platforms</th>
              {brands.map(b => <th key={b.id} className="brand-col"><span>{b.name}</span></th>)}
            </tr>
          </thead>
          <tbody>
            {hosts.map((h, idx) => {
              const on = active[h.id];
              const st = saving['active|' + h.id];
              return (
                <tr key={h.id} className={on ? undefined : 'row-inactive'}>
                  <td className="h sticky-col">
                    <Link href={`/admin/hosts/${h.id}`} data-tour={idx === 0 ? 'hosts-first' : undefined}><strong>{h.name}</strong></Link>
                    {h.needsSetup && on && <span className="badge bad" data-tip={'Needs setup:\nMissing a monthly cap, max % per brand or platforms. Click the name to fix; the scheduler won’t run until it’s done or the host is set to Inactive.'}> needs setup</span>}
                  </td>
                  <td className="h">
                    <select value={on ? 'active' : 'inactive'} aria-label={`${h.name} status`}
                      className={'active-select ' + (on ? 'on' : 'off') + (st ? ' ' + st : '')}
                      data-tip={'Status:\nActive hosts are scheduled. Inactive hosts are skipped by the scheduler and hidden from new pre-planned bookings; their settings and availability are kept.'}
                      onChange={e => setHostActive(h.id, e.target.value === 'active')}>
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </td>
                  <td className="h small">{h.login ?? <span className="muted">none</span>}</td>
                  <td className="num">{h.maxStreams ?? '–'}</td>
                  <td className="num">{h.maxBrandPct || '–'}</td>
                  <td className="h small">{h.platforms}</td>
                  {brands.map(b => {
                    const key = h.id + '|' + b.id;
                    const lv: Level = levels[key] || 'excluded';
                    const s = saving[key];
                    return (
                      <td key={b.id} className={'pref-cell ' + lv + (s ? ' ' + s : '')}>
                        <select value={lv} aria-label={`${h.name} for ${b.name}`} title={`${h.name} · ${b.name}: ${LEVEL_NAME[lv]}`}
                          onChange={e => setLevel(h.id, b.id, e.target.value as Level)}>
                          {(['preferred', 'regular', 'excluded'] as Level[]).map(l => <option key={l} value={l}>{LEVEL_LABEL[l]} {l === lv ? '' : '· ' + LEVEL_NAME[l]}</option>)}
                        </select>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
