import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScheduler, parsePlatforms, START_MINS, type SchedulerInput, type SchedulerHost } from '../lib/scheduler';

const host = (name: string, over: Partial<SchedulerHost> = {}): SchedulerHost => ({
  name, gender: 'female', maxStreamsMonth: 10, maxBrandPct: 1, platforms: 'TikTok, Shopee', allowedRooms: null,
  prefs: { Alpha: 'regular', Beta: 'regular' }, ...over,
});
const everyDay = (name: string, days: number, slots = [0, 1, 2, 3, 4, 5, 6]) =>
  Array.from({ length: days }, (_, i) => slots.map(slot => ({ host: name, day: i + 1, slot }))).flat();

const base = (over: Partial<SchedulerInput> = {}): SchedulerInput => ({
  year: 2026, month: 11,
  pct: { bauWeekday: 0.2, bauWeekend: 0.5, megaWeekday: 0.2, megaWeekend: 0.5 },
  saleDays: [{ name: 'Double digit D-Day', day: 12 }],
  rooms: [{ name: 'Yellow Room', status: 'available' }, { name: 'Blue Room', status: 'available' }],
  hosts: [host('Ann'), host('Bea')],
  availability: [...everyDay('Ann', 31), ...everyDay('Bea', 31)],
  commitments: [],
  preplanned: [],
  trials: 4,
  ...over,
});

test('parsePlatforms understands both sheet formats', () => {
  assert.deepEqual([...parsePlatforms('TikTok & Shopee')!].sort(), ['shopee', 'tiktok']);
  assert.deepEqual([...parsePlatforms('TikTok, Shopee')!].sort(), ['shopee', 'tiktok']);
  assert.equal(parsePlatforms('Lazada'), null);
});

test('fills BAU and Mega commitments on the right days', () => {
  const r = runScheduler(base({
    commitments: [
      { id: 0, brand: 'Alpha', period: 'BAU', sale: '-', platform: 'TikTok', qty: 5, priority: 1 },
      { id: 1, brand: 'Beta', period: 'Mega', sale: 'Double digit D-Day', platform: 'Shopee', qty: 2, priority: 1 },
    ],
  }));
  assert.ok(r.ok, r.message);
  assert.equal(r.stats.fulfilled, 7);
  const mega = r.streams.filter(s => s.brand === 'Beta');
  assert.equal(mega.length, 2);
  assert.ok(mega.every(s => s.day === 12 && s.period === 'MEGA'));
  assert.ok(r.streams.filter(s => s.brand === 'Alpha').every(s => s.day !== 12 && s.period === 'BAU'));
});

test('never schedules excluded brands, wrong platforms, or unavailable slots', () => {
  const r = runScheduler(base({
    hosts: [host('Ann', { prefs: { Alpha: 'excluded', Beta: 'regular' } }), host('Bea', { platforms: 'Shopee' })],
    availability: [...everyDay('Ann', 31, [5]), ...everyDay('Bea', 31, [1])],
    commitments: [
      { id: 0, brand: 'Alpha', period: 'bau', sale: '-', platform: 'Shopee', qty: 3, priority: 1 },
      { id: 1, brand: 'Beta', period: 'bau', sale: '-', platform: 'TikTok', qty: 3, priority: 1 },
    ],
  }));
  assert.ok(r.ok);
  for (const s of r.streams) {
    if (s.brand === 'Alpha') assert.equal(s.host, 'Bea'); // Ann excludes Alpha
    if (s.brand === 'Beta') assert.equal(s.host, 'Ann'); // Bea has no TikTok
    const slot = START_MINS.indexOf(s.start);
    assert.equal(slot, s.host === 'Ann' ? 5 : 1, 'only in marked availability');
  }
});

test('combined TikTok & Shopee needs a host on both platforms', () => {
  const r = runScheduler(base({
    hosts: [host('Ann', { platforms: 'TikTok' }), host('Bea')],
    commitments: [{ id: 0, brand: 'Alpha', period: 'bau', sale: '-', platform: 'TikTok & Shopee', qty: 3, priority: 1 }],
  }));
  assert.ok(r.streams.every(s => s.host === 'Bea'));
});

test('respects monthly caps, 2-per-day cap and no double booking', () => {
  const r = runScheduler(base({
    hosts: [host('Ann', { maxStreamsMonth: 4 }), host('Bea', { maxStreamsMonth: 4 })],
    commitments: [{ id: 0, brand: 'Alpha', period: 'bau', sale: '-', platform: 'TikTok', qty: 20, priority: 1 }],
  }));
  assert.equal(r.stats.fulfilled, 8);
  assert.equal(r.stats.unfulfilled, 12);
  for (const h of ['Ann', 'Bea']) {
    const mine = r.streams.filter(s => s.host === h);
    assert.ok(mine.length <= 4);
    const perDay = new Map<number, number>();
    mine.forEach(s => perDay.set(s.day, (perDay.get(s.day) || 0) + 1));
    assert.ok([...perDay.values()].every(n => n <= 2));
  }
  for (const a of r.streams) for (const b of r.streams) {
    if (a !== b && a.day === b.day && a.start < b.end && b.start < a.end) {
      assert.notEqual(a.host, b.host);
      assert.notEqual(a.room, b.room);
    }
  }
  assert.match(String(r.sections.find(s => s.title.startsWith('Unfulfilled'))!.rows[0][7]), /monthly host caps/);
});

test('brand share cap limits one host per brand', () => {
  const r = runScheduler(base({
    hosts: [host('Ann', { maxBrandPct: 0.5 }), host('Bea', { maxBrandPct: 0.5 })],
    commitments: [{ id: 0, brand: 'Alpha', period: 'bau', sale: '-', platform: 'TikTok', qty: 6, priority: 1 }],
  }));
  assert.equal(r.streams.filter(s => s.host === 'Ann').length, 3);
  assert.equal(r.streams.filter(s => s.host === 'Bea').length, 3);
});

test('rooms: unavailable never used, host room permissions honoured', () => {
  const r = runScheduler(base({
    rooms: [{ name: 'Yellow Room', status: 'unavailable' }, { name: 'Blue Room', status: 'available' }, { name: 'Main Room', status: 'available' }],
    hosts: [host('Ann', { allowedRooms: ['main room'] }), host('Bea')],
    commitments: [{ id: 0, brand: 'Alpha', period: 'bau', sale: '-', platform: 'TikTok', qty: 6, priority: 1 }],
  }));
  assert.ok(r.streams.every(s => s.room !== 'Yellow Room'));
  assert.ok(r.streams.filter(s => s.host === 'Ann').every(s => s.room === 'Main Room'));
});

test('pre-planned bookings are kept, counted, and blank hosts get assigned', () => {
  const r = runScheduler(base({
    commitments: [{ id: 0, brand: 'Alpha', period: 'bau', sale: '-', platform: 'TikTok', qty: 2, priority: 1 }],
    preplanned: [
      // odd-hour booking with a named host who is NOT available: still kept
      { day: 3, start: 21 * 60, end: 23 * 60, host: 'Ann', brand: 'Alpha', period: '', sale: '', platform: 'TikTok', room: '', source: 'P1' },
      // blank host: scheduler picks one
      { day: 4, start: 20 * 60, end: 22 * 60, host: '', brand: 'Beta', period: 'bau', sale: '', platform: 'Shopee', room: 'Blue Room', source: 'P2' },
    ],
    availability: [...everyDay('Ann', 31, [0, 1, 2, 3]), ...everyDay('Bea', 31)],
  }));
  assert.ok(r.ok);
  const p1 = r.streams.find(s => s.source === 'P1')!;
  assert.equal(p1.host, 'Ann');
  assert.equal(p1.start, 21 * 60);
  assert.ok(r.warnings.some(w => w.startsWith('P1') && w.includes('not marked available')));
  const p2 = r.streams.find(s => s.source === 'P2')!;
  assert.equal(p2.host, 'Bea');
  assert.equal(p2.room, 'Blue Room');
  assert.ok(p2.autoAssignedHost);
  // P1 counts toward the Alpha commitment, so only one more is auto-allocated.
  assert.equal(r.streams.filter(s => s.brand === 'Alpha').length, 2);
  // Nothing else overlaps Ann's 21:00-23:00 booking for Ann or its room.
  const clash = r.streams.filter(s => s !== p1 && s.day === 3 && s.start < p1.end && p1.start < s.end);
  assert.ok(clash.every(s => s.host !== 'Ann' && s.room !== p1.room));
});

test('missing host settings stop the run with a clear error', () => {
  const r = runScheduler(base({ hosts: [host('Ann', { maxStreamsMonth: null }), host('Bea', { platforms: '' })] }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => e.includes('Ann') && e.includes('max streams')));
  assert.ok(r.errors.some(e => e.includes('Bea') && e.includes('platforms')));
});

test('deterministic: same input gives the same schedule', () => {
  const input = base({ commitments: [{ id: 0, brand: 'Alpha', period: 'bau', sale: '-', platform: 'TikTok', qty: 8, priority: 1 }] });
  assert.deepEqual(runScheduler(input).streams, runScheduler(input).streams);
});

test('rules: same brand on different platforms can run together when allowed', () => {
  const input = base({
    // Only 5 evenings, 2 hosts: 10 streams fit only if TikTok and Shopee run side by side.
    hosts: [host('Ann'), host('Bea')],
    availability: [...everyDay('Ann', 5, [5]), ...everyDay('Bea', 5, [5])],
    commitments: [
      { id: 0, brand: 'Alpha', period: 'bau', sale: '-', platform: 'TikTok', qty: 5, priority: 1 },
      { id: 1, brand: 'Alpha', period: 'bau', sale: '-', platform: 'Shopee', qty: 5, priority: 1 },
    ],
  });
  const sameTime = (r: ReturnType<typeof runScheduler>) => r.streams.filter(a => r.streams.some(b => b !== a && b.day === a.day && b.start === a.start)).length;
  assert.equal(sameTime(runScheduler(input)), 0); // original rule: never together
  const r = runScheduler({ ...input, rules: { sameBrandDifferentPlatformOk: true } });
  assert.ok(sameTime(r) > 0);
  assert.equal(runScheduler(input).stats.fulfilled, 5);
  assert.equal(r.stats.fulfilled, 10);
  // ...but never two streams of the brand on the same platform at once
  for (const a of r.streams) for (const b of r.streams)
    if (a !== b && a.day === b.day && a.start === b.start) assert.notEqual(a.platform, b.platform);
});

test('rules: brands kept apart never overlap', () => {
  const input = base({
    commitments: [
      { id: 0, brand: 'Alpha', period: 'bau', sale: '-', platform: 'TikTok', qty: 20, priority: 1 },
      { id: 1, brand: 'Beta', period: 'bau', sale: '-', platform: 'Shopee', qty: 20, priority: 1 },
    ],
    availability: [...everyDay('Ann', 31, [5]), ...everyDay('Bea', 31, [5])],
    rules: { brandsApart: [['Alpha', 'Beta']] },
  });
  const r = runScheduler(input);
  for (const a of r.streams) for (const b of r.streams)
    if (a !== b && a.day === b.day && a.start === b.start) assert.equal(a.brand, b.brand);
});

test('rules: max per day, Friday never, no female 10PM-12MN', () => {
  const r = runScheduler(base({
    hosts: [host('Ann', { maxStreamsMonth: 40 })],
    availability: everyDay('Ann', 31),
    commitments: [{ id: 0, brand: 'Alpha', period: 'bau', sale: '-', platform: 'TikTok', qty: 40, priority: 1 }],
    rules: { maxStreamsPerHostPerDay: 1, fridayBau: 'never', lateFemale: 'never' },
  }));
  const perDay = new Map<number, number>();
  r.streams.forEach(s => perDay.set(s.day, (perDay.get(s.day) || 0) + 1));
  assert.ok([...perDay.values()].every(n => n <= 1));
  assert.ok(r.streams.every(s => new Date(2026, 11, s.day).getDay() !== 5 || s.period === 'MEGA'));
  assert.ok(r.streams.every(s => s.start !== 22 * 60));
});
