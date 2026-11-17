import Link from 'next/link';

/**
 * A clickable table header that sorts via ?sort=<key>&dir=asc|desc, keeping the other query params.
 * Clicking the active column flips the direction.
 */
export default function SortHeader({ label, k, sort, dir, params, className }: {
  label: string;
  k: string;
  sort: string;
  dir: 'asc' | 'desc';
  params: Record<string, string | undefined>;
  className?: string;
}) {
  const active = sort === k;
  const next = active && dir === 'asc' ? 'desc' : 'asc';
  const q = new URLSearchParams();
  Object.entries(params).forEach(([key, v]) => {
    if (v && !['sort', 'dir', 'ok', 'bad', 't', 'edit'].includes(key)) q.set(key, v);
  });
  q.set('sort', k);
  q.set('dir', next);
  return (
    <th className={className}>
      <Link href={'?' + q.toString()} className={'sort' + (active ? ' on' : '')} scroll={false}>
        {label}<span className="arrow">{active ? (dir === 'asc' ? ' ▲' : ' ▼') : ' ⇅'}</span>
      </Link>
    </th>
  );
}

export function readSort(sp: { sort?: string; dir?: string }, allowed: string[], fallback: string) {
  const sort = allowed.includes(sp.sort || '') ? sp.sort! : fallback;
  const dir: 'asc' | 'desc' = sp.dir === 'desc' ? 'desc' : 'asc';
  return { sort, dir };
}

/** Sorts rows by a key; ties fall back to date and start time when present. Empty values go last. */
export function sortRows<T extends Record<string, any>>(rows: T[], get: (r: T) => string | number, dir: 'asc' | 'desc') {
  const mult = dir === 'asc' ? 1 : -1;
  return rows.slice().sort((a, b) => {
    const x = get(a), y = get(b);
    if (x === '' && y !== '') return 1;
    if (y === '' && x !== '') return -1;
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
    if (c) return c * mult;
    return String(a.date ?? '').localeCompare(String(b.date ?? '')) || (a.start_min ?? 0) - (b.start_min ?? 0);
  });
}
